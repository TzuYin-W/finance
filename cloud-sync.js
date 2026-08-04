(() => {
  'use strict';

  const app = window.FinanceTrackerApp;
  if (!app) return;

  const APP_FILE_NAME = 'finance-tracker-sync.json';
  // 沿用既有 key，讓舊版 Google 設定可無痛遷移；儲存時會自動移除 OneDrive 欄位。
  const CONFIG_KEY = `${app.getStorageKey()}-cloud-config-v2`;
  const DEVICE_KEY = `${app.getStorageKey()}-device-id-v1`;
  const GOOGLE_SESSION_KEY = `${app.getStorageKey()}-google-session-v2`;
  const LEGACY_MICROSOFT_KEYS = [
    `${app.getStorageKey()}-microsoft-session-v1`,
    `${app.getStorageKey()}-microsoft-oauth-v1`,
    `${app.getStorageKey()}-microsoft-pending-v1`
  ];
  const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

  const cloudButton = document.getElementById('cloudSyncButton');
  const modal = document.getElementById('cloudSyncModal');
  if (!cloudButton || !modal) return;

  const closeButton = document.getElementById('cloudModalClose');
  const envNotice = document.getElementById('cloudEnvironmentNotice');
  const overallStatus = document.getElementById('cloudOverallStatus');
  const googleClientIdInput = document.getElementById('googleClientId');
  const autoSyncInput = document.getElementById('cloudAutoSync');
  const activeProviderSelect = document.getElementById('cloudActiveProvider');
  const googleOriginText = document.getElementById('googleJavascriptOrigin');
  const googleAccountText = document.getElementById('googleAccountStatus');
  const googleLastSyncText = document.getElementById('googleLastSync');
  const conflictPanel = document.getElementById('cloudConflictPanel');
  const conflictTitle = document.getElementById('cloudConflictTitle');
  const conflictMeta = document.getElementById('cloudConflictMeta');
  const conflictComparison = document.getElementById('cloudConflictComparison');
  const restoreCloudButton = document.getElementById('restoreCloudButton');

  const makeMemoryStorage = () => {
    const map = new Map();
    return {getItem:k=>map.has(String(k))?map.get(String(k)):null,setItem:(k,v)=>map.set(String(k),String(v)),removeItem:k=>map.delete(String(k))};
  };
  const safeStorage = name => {
    try {
      const target = window[name], key = `__finance_${name}_test__`;
      target.setItem(key,'1'); target.removeItem(key); return target;
    } catch (_) { return makeMemoryStorage(); }
  };
  const localStore = safeStorage('localStorage');
  const sessionStore = safeStorage('sessionStorage');

  let config = loadConfig();
  let busy = false;
  let autoTimer = null;
  let googleTokenClient = null;
  let googlePending = null;
  let pendingConflict = null;

  function defaultGoogleState(){return {email:'',fileId:'',lastSyncedAt:'',lastSyncedHash:''};}
  function loadConfig(){
    try {
      const saved = JSON.parse(localStore.getItem(CONFIG_KEY)||'{}');
      const migrated = {
        googleClientId:String(saved.googleClientId||''),
        autoSync:Boolean(saved.autoSync) && saved.activeProvider==='google',
        activeProvider:saved.activeProvider==='google'?'google':'',
        google:{...defaultGoogleState(),...(saved.google||{})}
      };
      // 直接覆寫成 Google-only 結構，移除舊 Microsoft Client、OneDrive 狀態與 Refresh Token 參照。
      localStore.setItem(CONFIG_KEY,JSON.stringify(migrated));
      return migrated;
    } catch (_) {
      return {googleClientId:'',autoSync:false,activeProvider:'',google:defaultGoogleState()};
    }
  }
  function saveConfig(){localStore.setItem(CONFIG_KEY,JSON.stringify(config));renderUi();}
  function cleanupLegacyMicrosoftState(){LEGACY_MICROSOFT_KEYS.forEach(key=>{localStore.removeItem(key);sessionStore.removeItem(key);});}
  function getDeviceId(){
    let id=localStore.getItem(DEVICE_KEY);
    if(!id){id=`device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;localStore.setItem(DEVICE_KEY,id);}
    return id;
  }
  function isSecureEnvironment(){return location.protocol==='https:'||(location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname));}
  function getGoogleOrigin(){return location.protocol==='file:'?'':location.origin;}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function formatTime(value){
    if(!value)return '尚未同步';
    const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);
    return new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(date);
  }
  function setStatus(message,type=''){overallStatus.textContent=message;overallStatus.dataset.type=type;}
  function setBusy(value,message=''){
    busy=value;
    modal.querySelectorAll('[data-cloud-action]').forEach(button=>button.disabled=value);
    if(message)setStatus(message,'working');
    renderUi();
  }
  function readSession(key){try{return JSON.parse(sessionStore.getItem(key)||'null');}catch(_){return null;}}
  function writeSession(key,value){if(value)sessionStore.setItem(key,JSON.stringify(value));else sessionStore.removeItem(key);}

  function renderUi(){
    googleClientIdInput.value=config.googleClientId;
    autoSyncInput.checked=config.autoSync;
    activeProviderSelect.value=config.activeProvider;
    googleOriginText.textContent=getGoogleOrigin()||'file:// 無法使用 OAuth';

    const secure=isSecureEnvironment();
    envNotice.className=`cloud-notice ${secure?'ok':'warning'}`;
    envNotice.innerHTML=secure
      ? `<strong>目前網址可使用 Google Drive 登入。</strong><br>同步只會存取 Google Drive 的 App Data 專屬空間；本機資料仍會保留。`
      : `<strong>直接開啟 HTML 檔無法登入 Google Drive。</strong><br>請把完整包部署到 HTTPS 網址，或由 localhost 開啟。記帳與 JSON 備份仍可離線使用。`;

    const session=readSession(GOOGLE_SESSION_KEY);
    googleAccountText.textContent=session?.accessToken&&session.expiresAt>Date.now()?`已連線：${config.google.email||'Google 帳戶'}`:(config.google.email?`上次帳戶：${config.google.email}（需重新授權）`:'尚未連線');
    googleLastSyncText.textContent=formatTime(config.google.lastSyncedAt);

    modal.querySelectorAll('[data-requires-secure]').forEach(el=>el.disabled=busy||!secure);
    modal.querySelectorAll('[data-provider="google"][data-needs-client]').forEach(el=>el.disabled=busy||!secure||!config.googleClientId);
    if(restoreCloudButton)restoreCloudButton.hidden=!app.getCloudRollback();

    cloudButton.textContent=config.autoSync&&config.activeProvider==='google'?`☁ Google Drive${config.google.lastSyncedAt?' · 已同步':''}`:'☁ Google Drive';
  }

  function stableStringify(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  async function sha256(text){
    if(crypto?.subtle){
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }
    let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return `fnv-${(hash>>>0).toString(16)}`;
  }
  async function hashState(data){
    const copy=JSON.parse(JSON.stringify(data));
    if(copy.meta)delete copy.meta.updatedAt;
    return sha256(stableStringify(copy));
  }
  async function makeEnvelope(){
    const data=app.getState();
    return {
      app:'finance-tracker-webapp',formatVersion:2,schemaVersion:app.getSchemaVersion(),
      updatedAt:app.getLocalUpdatedAt()||new Date().toISOString(),deviceId:getDeviceId(),
      dataHash:await hashState(data),data
    };
  }
  async function normalizeEnvelope(raw,fallbackUpdatedAt=''){
    let envelope;
    if(raw?.app==='finance-tracker-webapp'&&raw?.data)envelope=raw;
    else if(raw?.meta&&raw?.cash)envelope={app:'finance-tracker-webapp',formatVersion:1,schemaVersion:Number(raw.meta.schemaVersion)||0,updatedAt:raw.meta.updatedAt||fallbackUpdatedAt||new Date(0).toISOString(),deviceId:'legacy',data:raw};
    else throw new Error('雲端檔案不是有效的財務追蹤資料。');
    const validation=app.validateBackup(envelope.data);
    if(!validation.compatible)throw new Error(validation.errors.join(' ')||'雲端資料格式與目前 App 不相容。');
    envelope.dataHash=envelope.dataHash||await hashState(envelope.data);
    envelope.updatedAt=envelope.updatedAt||fallbackUpdatedAt||new Date(0).toISOString();
    return envelope;
  }

  function normalizeGoogleClientId(value){
    return String(value??'').normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g,'');
  }
  function maskGoogleClientId(value){
    const id=normalizeGoogleClientId(value);
    if(id.length<=28)return id||'未設定';
    return `${id.slice(0,12)}…${id.slice(-16)}`;
  }
  function commitGoogleClientId(){
    const normalized=normalizeGoogleClientId(googleClientIdInput.value||config.googleClientId);
    googleClientIdInput.value=normalized;
    if(config.googleClientId!==normalized){
      config.googleClientId=normalized;
      googleTokenClient=null;
      writeSession(GOOGLE_SESSION_KEY,null);
      localStore.setItem(CONFIG_KEY,JSON.stringify(config));
    }
    return normalized;
  }
  async function loadGoogleIdentity(){
    if(window.google?.accounts?.oauth2)return;
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-google-identity]');
      if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('無法載入 Google 登入元件。')),{once:true});return;}
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset.googleIdentity='true';script.onload=resolve;script.onerror=()=>reject(new Error('無法載入 Google 登入元件。'));document.head.appendChild(script);
    });
  }
  async function getGoogleToken(interactive=false){
    const session=readSession(GOOGLE_SESSION_KEY);
    if(session?.accessToken&&session.expiresAt>Date.now()+60000)return session.accessToken;
    if(!interactive)return null;
    const clientId=commitGoogleClientId();
    if(!clientId)throw new Error('請先輸入 Google OAuth Client ID。');
    if(!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)){
      throw new Error(`Google Client ID 格式不正確（目前長度 ${clientId.length}）。請貼上 Web application 的 Client ID，不要貼 Client secret、Project ID 或 API key。`);
    }
    if(!isSecureEnvironment())throw new Error('Google 登入必須由 HTTPS 或 localhost 開啟。');
    await loadGoogleIdentity();
    googleTokenClient=google.accounts.oauth2.initTokenClient({
      client_id:clientId,scope:GOOGLE_DRIVE_SCOPE,
      callback:response=>{if(!googlePending)return;if(response.error)googlePending.reject(new Error(response.error_description||response.error));else googlePending.resolve(response);googlePending=null;},
      error_callback:error=>{if(!googlePending)return;googlePending.reject(new Error(error?.message||error?.type||'Google 登入視窗已關閉。'));googlePending=null;}
    });
    setStatus(`正在向 Google 送出 Client ID：${maskGoogleClientId(clientId)}（長度 ${clientId.length}）`,'working');
    const response=await new Promise((resolve,reject)=>{googlePending={resolve,reject};googleTokenClient.requestAccessToken({prompt:'consent',scope:GOOGLE_DRIVE_SCOPE});});
    const granted=typeof google.accounts.oauth2.hasGrantedAllScopes==='function'
      ? google.accounts.oauth2.hasGrantedAllScopes(response,GOOGLE_DRIVE_SCOPE)
      : String(response.scope||'').split(/\s+/).includes(GOOGLE_DRIVE_SCOPE);
    if(!granted){
      if(response.access_token&&window.google?.accounts?.oauth2){try{google.accounts.oauth2.revoke(response.access_token,()=>{});}catch(_){}}
      writeSession(GOOGLE_SESSION_KEY,null);
      throw new Error('Google 登入成功，但沒有授權「儲存應用程式資料」權限。請在 Google 同意畫面核准 Google Drive App Data，然後重新連線。');
    }
    const saved={accessToken:response.access_token,expiresAt:Date.now()+Math.max(60,Number(response.expires_in||3600)-60)*1000,scope:response.scope||GOOGLE_DRIVE_SCOPE};
    writeSession(GOOGLE_SESSION_KEY,saved);
    config.google.email='';
    saveConfig();
    return saved.accessToken;
  }
  async function googleFetch(url,options={},token=null){
    const accessToken=token||await getGoogleToken(false);if(!accessToken)throw new Error('Google 尚未登入，或授權已過期。');
    const response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}});
    if(response.status===401)writeSession(GOOGLE_SESSION_KEY,null);
    if(!response.ok){
      let detail='',reason='';
      try{const payload=await response.json();detail=payload?.error?.message||'';reason=payload?.error?.status||payload?.error?.errors?.[0]?.reason||'';}catch(_){}
      if(response.status===403&&/insufficient authentication scopes/i.test(detail)){
        writeSession(GOOGLE_SESSION_KEY,null);
        throw new Error('目前的 Google 授權不含 Drive App Data。請按「中斷連線」後重新連線，並在同意畫面核准儲存應用程式資料。');
      }
      throw new Error(detail||reason||`Google Drive 回應錯誤（${response.status}）。`);
    }
    if(response.status===204)return null;const type=response.headers.get('content-type')||'';return type.includes('application/json')?response.json():response.text();
  }
  async function googleFindFile(){
    const params=new URLSearchParams({spaces:'appDataFolder',q:`name='${APP_FILE_NAME}' and trashed=false`,fields:'files(id,name,modifiedTime,size)',orderBy:'modifiedTime desc',pageSize:'10'});
    const result=await googleFetch(`https://www.googleapis.com/drive/v3/files?${params}`);return result.files?.[0]||null;
  }
  async function googleReadRemote(){
    const file=await googleFindFile();if(!file)return null;
    const raw=await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
    const parsed=typeof raw==='string'?JSON.parse(raw):raw;return {file,envelope:await normalizeEnvelope(parsed,file.modifiedTime)};
  }
  async function googleWriteRemote(envelope,remote=null){
    const body=JSON.stringify(envelope,null,2);
    if(remote?.file?.id)return googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(remote.file.id)}?uploadType=media&fields=id,name,modifiedTime,size`,{method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},body});
    const boundary=`finance_${Math.random().toString(36).slice(2)}`;
    const metadata=JSON.stringify({name:APP_FILE_NAME,parents:['appDataFolder'],mimeType:'application/json'});
    const multipart=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
    return googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body:multipart});
  }
  async function googleDisconnect(){
    const session=readSession(GOOGLE_SESSION_KEY);
    if(session?.accessToken&&window.google?.accounts?.oauth2)await new Promise(resolve=>google.accounts.oauth2.revoke(session.accessToken,()=>resolve()));
    writeSession(GOOGLE_SESSION_KEY,null);renderUi();setStatus('已中斷 Google 連線；雲端同步檔不會被刪除。','ok');
  }

  function markSynced(envelope,result=null){
    config.google.lastSyncedAt=envelope.updatedAt;
    config.google.lastSyncedHash=envelope.dataHash;
    config.google.fileId=result?.id||config.google.fileId;
    saveConfig();app.setSaveStatus('本機與 Google Drive 已同步');
  }
  async function uploadEnvelope(local,remote=null){
    setStatus('正在上傳至 Google Drive…','working');
    const result=await googleWriteRemote(local,remote);markSynced(local,result);setStatus(`同步完成：${formatTime(local.updatedAt)}`,'ok');app.toast('Google Drive 同步完成');
  }
  async function applyRemote(remote){
    app.createCloudRollback('Google Drive');
    app.replaceStateFromCloud(remote.envelope.data,remote.envelope.updatedAt);
    markSynced(remote.envelope,remote.file);
    setStatus(`已載入 Google Drive：${formatTime(remote.envelope.updatedAt)}`,'ok');app.toast('已載入 Google Drive 資料');renderUi();
  }
  function showConflict(local,remote,reason='本機與雲端都有不同內容。'){
    pendingConflict={local,remote};
    const localSummary=app.summarizeState(local.data),remoteSummary=app.summarizeState(remote.envelope.data);
    const rows=[['現金花費','cash'],['信用卡記錄','credit'],['卡費記錄','cardFees'],['家的支出','home'],['分期','installments'],['房貸','mortgage'],['稅費、投資','taxInvest'],['午餐花費','lunch']];
    conflictTitle.textContent='Google Drive 同步衝突';
    conflictMeta.innerHTML=`${escapeHtml(reason)}<br>本機：${escapeHtml(formatTime(local.updatedAt))}；雲端：${escapeHtml(formatTime(remote.envelope.updatedAt))}`;
    conflictComparison.innerHTML=`<table class="import-compare"><thead><tr><th>分頁</th><th>本機</th><th>雲端</th></tr></thead><tbody>${rows.map(([label,key])=>`<tr><td>${label}</td><td>${escapeHtml(localSummary[key])}</td><td>${escapeHtml(remoteSummary[key])}</td></tr>`).join('')}</tbody></table>`;
    conflictPanel.hidden=false;setStatus('偵測到同步衝突，已停止自動覆蓋。','warning');
  }
  function clearConflict(){pendingConflict=null;conflictPanel.hidden=true;}

  async function smartSync(interactive=true){
    if(busy)return;
    const token=await getGoogleToken(interactive);
    if(!token){if(!interactive)setStatus('Google Drive 尚未登入；本機資料已保留。','warning');return;}
    setBusy(true,'正在比較 Google Drive 的資料…');
    try{
      const [local,remote]=await Promise.all([makeEnvelope(),googleReadRemote()]);
      if(!remote){await uploadEnvelope(local,null);clearConflict();return;}
      if(local.dataHash===remote.envelope.dataHash){markSynced(remote.envelope,remote.file);setStatus('本機與雲端內容相同，不需更新。','ok');clearConflict();return;}
      const lastHash=config.google.lastSyncedHash||'';
      if(!lastHash){showConflict(local,remote,'這是此裝置第一次與既有雲端檔案同步，請選擇要保留哪一份。');return;}
      const localChanged=local.dataHash!==lastHash,remoteChanged=remote.envelope.dataHash!==lastHash;
      if(localChanged&&!remoteChanged){await uploadEnvelope(local,remote);clearConflict();return;}
      if(!localChanged&&remoteChanged){await applyRemote(remote);clearConflict();return;}
      showConflict(local,remote,'本機與雲端都在上次同步後被修改，不能安全地自動合併。');
    }catch(error){setStatus(error.message,'error');if(interactive)alert(error.message);}
    finally{setBusy(false);renderUi();}
  }
  async function forceUpload(){
    if(busy)return;const token=await getGoogleToken(true);if(!token)return;
    setBusy(true,'正在讀取 Google Drive…');
    try{
      const [local,remote]=await Promise.all([makeEnvelope(),googleReadRemote()]);
      if(remote&&remote.envelope.dataHash!==local.dataHash&&!confirm('這會用目前本機資料覆蓋 Google Drive。確定繼續？'))return;
      await uploadEnvelope(local,remote);clearConflict();
    }catch(error){setStatus(error.message,'error');alert(error.message);}finally{setBusy(false);renderUi();}
  }
  async function forceDownload(){
    if(busy)return;const token=await getGoogleToken(true);if(!token)return;
    setBusy(true,'正在讀取 Google Drive…');
    try{
      const local=await makeEnvelope(),remote=await googleReadRemote();
      if(!remote){setStatus('Google Drive 尚無同步檔。','warning');return;}
      if(local.dataHash===remote.envelope.dataHash){markSynced(remote.envelope,remote.file);setStatus('本機與雲端內容相同。','ok');return;}
      showConflict(local,remote,'你選擇載入雲端資料。請先比較內容，再決定是否覆蓋本機。');
    }catch(error){setStatus(error.message,'error');alert(error.message);}finally{setBusy(false);renderUi();}
  }

  function openModal(){modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('modal-open');renderUi();}
  function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');if(document.getElementById('importDialog')?.hidden!==false)document.body.classList.remove('modal-open');}

  cloudButton.addEventListener('click',openModal);
  closeButton.addEventListener('click',closeModal);
  modal.addEventListener('click',event=>{if(event.target===modal)closeModal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))closeModal();});

  googleClientIdInput.addEventListener('change',()=>{commitGoogleClientId();saveConfig();});
  googleClientIdInput.addEventListener('paste',()=>setTimeout(()=>{googleClientIdInput.value=normalizeGoogleClientId(googleClientIdInput.value);},0));
  autoSyncInput.addEventListener('change',()=>{config.autoSync=autoSyncInput.checked;config.activeProvider=config.autoSync?'google':'';activeProviderSelect.value=config.activeProvider;saveConfig();});
  activeProviderSelect.addEventListener('change',()=>{config.activeProvider=activeProviderSelect.value;config.autoSync=config.activeProvider==='google'&&autoSyncInput.checked;saveConfig();});

  modal.addEventListener('click',async event=>{
    const button=event.target.closest('[data-cloud-action]');if(!button)return;
    const action=button.dataset.cloudAction;
    try{
      if(action==='google-login'){commitGoogleClientId();setBusy(true,`正在開啟 Google 登入（${maskGoogleClientId(config.googleClientId)}）…`);await getGoogleToken(true);setStatus('Google Drive App Data 授權完成。','ok');}
      if(action==='google-sync')await smartSync(true);
      if(action==='google-upload')await forceUpload();
      if(action==='google-download')await forceDownload();
      if(action==='google-logout')await googleDisconnect();
      if(action==='copy-google-origin'){await navigator.clipboard.writeText(getGoogleOrigin());app.toast('JavaScript origin 已複製');}
      if(action==='conflict-local'&&pendingConflict){const {local,remote}=pendingConflict;setBusy(true,'正在以上傳本機資料解決衝突…');await uploadEnvelope(local,remote);clearConflict();}
      if(action==='conflict-cloud'&&pendingConflict){const {remote}=pendingConflict;if(confirm('確定採用雲端資料並覆蓋本機嗎？App 會保留一份可復原快照。')){setBusy(true,'正在載入雲端資料…');await applyRemote(remote);clearConflict();}}
      if(action==='conflict-cancel')clearConflict();
      if(action==='restore-cloud'){
        const snapshot=app.getCloudRollback();if(!snapshot){alert('找不到可復原資料。');return;}
        if(!confirm(`要復原到 ${formatTime(snapshot.createdAt)} 的雲端載入前狀態嗎？`))return;
        app.downloadJson(app.getState(),`財務追蹤_雲端復原前備份_${app.fileStamp()}.json`);
        app.restoreCloudRollback();config.google.lastSyncedHash='';saveConfig();setStatus('已復原雲端載入前資料；下次同步會重新比對。','ok');app.toast('已復原雲端載入前資料');
      }
    }catch(error){setStatus(error.message,'error');alert(error.message);}
    finally{if(action==='google-login'||action==='conflict-local'||action==='conflict-cloud'){setBusy(false);renderUi();}}
  });

  window.addEventListener('finance-tracker-local-saved',()=>{
    if(!config.autoSync||config.activeProvider!=='google')return;
    clearTimeout(autoTimer);autoTimer=setTimeout(()=>smartSync(false),3000);
  });
  window.addEventListener('online',()=>{if(config.autoSync&&config.activeProvider==='google')smartSync(false);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&config.autoSync&&config.activeProvider==='google')smartSync(false);});

  cleanupLegacyMicrosoftState();
  renderUi();
})();
