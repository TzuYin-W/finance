(() => {
  'use strict';

  const app = window.FinanceTrackerApp;
  if (!app) return;

  const APP_FILE_NAME = 'finance-tracker-sync.json';
  const CONFIG_KEY = `${app.getStorageKey()}-cloud-config-v2`;
  const DEVICE_KEY = `${app.getStorageKey()}-device-id-v1`;
  const GOOGLE_SESSION_KEY = `${app.getStorageKey()}-google-session-v1`;
  const MICROSOFT_SESSION_KEY = `${app.getStorageKey()}-microsoft-session-v1`;
  const MICROSOFT_OAUTH_KEY = `${app.getStorageKey()}-microsoft-oauth-v1`;
  const MICROSOFT_PENDING_KEY = `${app.getStorageKey()}-microsoft-pending-v1`;
  const GOOGLE_SCOPES = 'email https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.appdata';
  const MICROSOFT_SCOPES = 'openid profile email offline_access Files.ReadWrite.AppFolder';

  const cloudButton = document.getElementById('cloudSyncButton');
  const modal = document.getElementById('cloudSyncModal');
  if (!cloudButton || !modal) return;

  const closeButton = document.getElementById('cloudModalClose');
  const envNotice = document.getElementById('cloudEnvironmentNotice');
  const overallStatus = document.getElementById('cloudOverallStatus');
  const googleClientIdInput = document.getElementById('googleClientId');
  const microsoftClientIdInput = document.getElementById('microsoftClientId');
  const autoSyncInput = document.getElementById('cloudAutoSync');
  const activeProviderSelect = document.getElementById('cloudActiveProvider');
  const googleOriginText = document.getElementById('googleJavascriptOrigin');
  const microsoftRedirectText = document.getElementById('microsoftRedirectUri');
  const googleAccountText = document.getElementById('googleAccountStatus');
  const microsoftAccountText = document.getElementById('microsoftAccountStatus');
  const googleLastSyncText = document.getElementById('googleLastSync');
  const microsoftLastSyncText = document.getElementById('microsoftLastSync');
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

  function defaultProviderState(){return {email:'',fileId:'',lastSyncedAt:'',lastSyncedHash:''};}
  function loadConfig(){
    try {
      const saved = JSON.parse(localStore.getItem(CONFIG_KEY)||'{}');
      return {
        googleClientId:String(saved.googleClientId||''),
        microsoftClientId:String(saved.microsoftClientId||''),
        autoSync:Boolean(saved.autoSync),
        activeProvider:['google','onedrive'].includes(saved.activeProvider)?saved.activeProvider:'',
        google:{...defaultProviderState(),...(saved.google||{})},
        onedrive:{...defaultProviderState(),appRootId:'',...(saved.onedrive||{})}
      };
    } catch (_) {
      return {googleClientId:'',microsoftClientId:'',autoSync:false,activeProvider:'',google:defaultProviderState(),onedrive:{...defaultProviderState(),appRootId:''}};
    }
  }
  function saveConfig(){localStore.setItem(CONFIG_KEY,JSON.stringify(config));renderUi();}
  function getDeviceId(){
    let id=localStore.getItem(DEVICE_KEY);
    if(!id){id=`device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;localStore.setItem(DEVICE_KEY,id);}
    return id;
  }
  function isSecureEnvironment(){return location.protocol==='https:'||(location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname));}
  function getMicrosoftRedirectUri(){return location.protocol==='file:'?'':`${location.origin}${location.pathname}`;}
  function getGoogleOrigin(){return location.protocol==='file:'?'':location.origin;}
  function providerName(provider){return provider==='google'?'Google Drive':'OneDrive';}
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
    microsoftClientIdInput.value=config.microsoftClientId;
    autoSyncInput.checked=config.autoSync;
    activeProviderSelect.value=config.activeProvider;
    googleOriginText.textContent=getGoogleOrigin()||'file:// 無法使用 OAuth';
    microsoftRedirectText.textContent=getMicrosoftRedirectUri()||'file:// 無法使用 OAuth';

    const secure=isSecureEnvironment();
    envNotice.className=`cloud-notice ${secure?'ok':'warning'}`;
    envNotice.innerHTML=secure
      ? `<strong>目前網址可使用雲端登入。</strong><br>同步只會存取 App 專屬資料空間；本機資料仍會保留。`
      : `<strong>直接開啟 HTML 檔無法登入雲端。</strong><br>請把完整包部署到 HTTPS 網址，或由 localhost 開啟。記帳與 JSON 備份仍可離線使用。`;

    const g=readSession(GOOGLE_SESSION_KEY),m=readSession(MICROSOFT_SESSION_KEY);
    googleAccountText.textContent=g?.accessToken&&g.expiresAt>Date.now()?`已連線：${config.google.email||'Google 帳戶'}`:(config.google.email?`上次帳戶：${config.google.email}（需重新授權）`:'尚未連線');
    microsoftAccountText.textContent=(m?.accessToken&&m.expiresAt>Date.now())||m?.refreshToken?`已連線：${config.onedrive.email||'Microsoft 帳戶'}`:(config.onedrive.email?`上次帳戶：${config.onedrive.email}（需重新登入）`:'尚未連線');
    googleLastSyncText.textContent=formatTime(config.google.lastSyncedAt);
    microsoftLastSyncText.textContent=formatTime(config.onedrive.lastSyncedAt);

    modal.querySelectorAll('[data-requires-secure]').forEach(el=>el.disabled=busy||!secure);
    modal.querySelectorAll('[data-provider="google"][data-needs-client]').forEach(el=>el.disabled=busy||!secure||!config.googleClientId);
    modal.querySelectorAll('[data-provider="onedrive"][data-needs-client]').forEach(el=>el.disabled=busy||!secure||!config.microsoftClientId);
    if(restoreCloudButton)restoreCloudButton.hidden=!app.getCloudRollback();

    const provider=config.activeProvider?providerName(config.activeProvider):'';
    const last=config.activeProvider?config[config.activeProvider].lastSyncedAt:'';
    cloudButton.textContent=config.autoSync&&provider?`☁ ${provider}${last?' · 已同步':''}`:'☁ 雲端同步';
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
    if(!config.googleClientId)throw new Error('請先輸入 Google OAuth Client ID。');
    if(!isSecureEnvironment())throw new Error('Google 登入必須由 HTTPS 或 localhost 開啟。');
    await loadGoogleIdentity();
    if(!googleTokenClient){
      googleTokenClient=google.accounts.oauth2.initTokenClient({
        client_id:config.googleClientId,scope:GOOGLE_SCOPES,
        callback:response=>{if(!googlePending)return;if(response.error)googlePending.reject(new Error(response.error_description||response.error));else googlePending.resolve(response);googlePending=null;},
        error_callback:error=>{if(!googlePending)return;googlePending.reject(new Error(error?.message||error?.type||'Google 登入視窗已關閉。'));googlePending=null;}
      });
    }
    const response=await new Promise((resolve,reject)=>{googlePending={resolve,reject};googleTokenClient.requestAccessToken({prompt:'consent'});});
    const saved={accessToken:response.access_token,expiresAt:Date.now()+Math.max(60,Number(response.expires_in||3600)-60)*1000};
    writeSession(GOOGLE_SESSION_KEY,saved);
    try{const profile=await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo',{},saved.accessToken);config.google.email=profile.email||config.google.email;saveConfig();}catch(_){}
    return saved.accessToken;
  }
  async function googleFetch(url,options={},token=null){
    const accessToken=token||await getGoogleToken(false);if(!accessToken)throw new Error('Google 尚未登入，或授權已過期。');
    const response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}});
    if(response.status===401)writeSession(GOOGLE_SESSION_KEY,null);
    if(!response.ok){let detail='';try{detail=(await response.json())?.error?.message||'';}catch(_){}throw new Error(detail||`Google Drive 回應錯誤（${response.status}）。`);}
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

  function base64Url(bytes){let binary='';new Uint8Array(bytes).forEach(b=>binary+=String.fromCharCode(b));return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
  function randomString(size=48){const bytes=new Uint8Array(size);crypto.getRandomValues(bytes);return base64Url(bytes);}
  async function sha256Base64Url(value){return base64Url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
  async function microsoftStartLogin(action='smart'){
    if(!config.microsoftClientId)throw new Error('請先輸入 Microsoft Application (client) ID。');
    if(!isSecureEnvironment())throw new Error('Microsoft 登入必須由 HTTPS 或 localhost 開啟。');
    const verifier=randomString(64),stateValue=randomString(24),challenge=await sha256Base64Url(verifier),redirectUri=getMicrosoftRedirectUri();
    sessionStore.setItem(MICROSOFT_OAUTH_KEY,JSON.stringify({verifier,state:stateValue,redirectUri,createdAt:Date.now()}));
    sessionStore.setItem(MICROSOFT_PENDING_KEY,action);
    const params=new URLSearchParams({client_id:config.microsoftClientId,response_type:'code',redirect_uri:redirectUri,response_mode:'query',scope:MICROSOFT_SCOPES,state:stateValue,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'});
    location.assign(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
  }
  async function microsoftTokenRequest(params){
    const response=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
    const data=await response.json();if(!response.ok)throw new Error(data.error_description||data.error||`Microsoft 登入失敗（${response.status}）。`);
    const prior=readSession(MICROSOFT_SESSION_KEY)||{};
    const saved={accessToken:data.access_token,refreshToken:data.refresh_token||prior.refreshToken||'',expiresAt:Date.now()+Math.max(60,Number(data.expires_in||3600)-60)*1000,scope:data.scope||MICROSOFT_SCOPES};
    writeSession(MICROSOFT_SESSION_KEY,saved);return saved;
  }
  async function handleMicrosoftRedirect(){
    const params=new URLSearchParams(location.search);if(!params.has('code')&&!params.has('error'))return;
    const oauth=readSession(MICROSOFT_OAUTH_KEY),returnedState=params.get('state');
    history.replaceState({},document.title,`${location.origin}${location.pathname}${location.hash||''}`);
    if(params.has('error'))throw new Error(params.get('error_description')||params.get('error'));
    if(!oauth||oauth.state!==returnedState)throw new Error('Microsoft 登入狀態驗證失敗，請重新登入。');
    await microsoftTokenRequest({client_id:config.microsoftClientId,grant_type:'authorization_code',code:params.get('code'),redirect_uri:oauth.redirectUri,code_verifier:oauth.verifier,scope:MICROSOFT_SCOPES});
    sessionStore.removeItem(MICROSOFT_OAUTH_KEY);
    try{const profile=await graphFetch('/me?$select=displayName,mail,userPrincipalName');config.onedrive.email=profile.mail||profile.userPrincipalName||profile.displayName||config.onedrive.email;config.onedrive.appRootId='';saveConfig();}catch(_){}
    app.toast('Microsoft 帳戶連線完成');
    const action=sessionStore.getItem(MICROSOFT_PENDING_KEY)||'smart';sessionStore.removeItem(MICROSOFT_PENDING_KEY);
    openModal();
    if(action==='upload')await forceUpload('onedrive');else if(action==='download')await forceDownload('onedrive');else await smartSync('onedrive',false);
  }
  async function getMicrosoftToken(interactive=false,action='smart'){
    const session=readSession(MICROSOFT_SESSION_KEY);
    if(session?.accessToken&&session.expiresAt>Date.now()+60000)return session.accessToken;
    if(session?.refreshToken&&config.microsoftClientId){
      try{return (await microsoftTokenRequest({client_id:config.microsoftClientId,grant_type:'refresh_token',refresh_token:session.refreshToken,scope:MICROSOFT_SCOPES})).accessToken;}catch(_){writeSession(MICROSOFT_SESSION_KEY,null);}
    }
    if(interactive){await microsoftStartLogin(action);return null;}return null;
  }
  async function graphFetch(path,options={},token=null){
    const accessToken=token||await getMicrosoftToken(false);if(!accessToken)throw new Error('Microsoft 尚未登入，或授權已過期。');
    const response=await fetch(`https://graph.microsoft.com/v1.0${path}`,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${accessToken}`}});
    if(response.status===401)writeSession(MICROSOFT_SESSION_KEY,null);
    if(!response.ok){let detail='';try{const body=await response.json();detail=body?.error?.message||body?.error?.code||'';}catch(_){}const error=new Error(detail||`OneDrive 回應錯誤（${response.status}）。`);error.status=response.status;throw error;}
    if(response.status===204)return null;const type=response.headers.get('content-type')||'';return type.includes('application/json')?response.json():response.text();
  }
  async function oneDriveAppRoot(){
    if(config.onedrive.appRootId)return {id:config.onedrive.appRootId};
    const root=await graphFetch('/me/drive/special/approot?$select=id,name,lastModifiedDateTime,webUrl');config.onedrive.appRootId=root.id;saveConfig();return root;
  }
  async function oneDriveFindFile(){
    const root=await oneDriveAppRoot();
    try{return await graphFetch(`/me/drive/items/${encodeURIComponent(root.id)}:/${encodeURIComponent(APP_FILE_NAME)}?$select=id,name,lastModifiedDateTime,size`);}catch(error){if(error.status===404)return null;throw error;}
  }
  async function oneDriveReadRemote(){
    const file=await oneDriveFindFile();if(!file)return null;
    const raw=await graphFetch(`/me/drive/items/${encodeURIComponent(file.id)}/content`);const parsed=typeof raw==='string'?JSON.parse(raw):raw;return {file,envelope:await normalizeEnvelope(parsed,file.lastModifiedDateTime)};
  }
  async function oneDriveWriteRemote(envelope){
    const root=await oneDriveAppRoot();
    return graphFetch(`/me/drive/items/${encodeURIComponent(root.id)}:/${encodeURIComponent(APP_FILE_NAME)}:/content`,{method:'PUT',headers:{'Content-Type':'application/json; charset=UTF-8'},body:JSON.stringify(envelope,null,2)});
  }
  async function microsoftDisconnect(){writeSession(MICROSOFT_SESSION_KEY,null);config.onedrive.appRootId='';saveConfig();setStatus('已中斷 Microsoft 連線；OneDrive 同步檔不會被刪除。','ok');}

  async function ensureToken(provider,interactive,action='smart'){return provider==='google'?getGoogleToken(interactive):getMicrosoftToken(interactive,action);}
  async function readRemote(provider){return provider==='google'?googleReadRemote():oneDriveReadRemote();}
  async function writeRemote(provider,envelope,remote=null){return provider==='google'?googleWriteRemote(envelope,remote):oneDriveWriteRemote(envelope);}
  function markSynced(provider,envelope,result=null){
    config[provider].lastSyncedAt=envelope.updatedAt;
    config[provider].lastSyncedHash=envelope.dataHash;
    config[provider].fileId=result?.id||config[provider].fileId;
    saveConfig();app.setSaveStatus(`本機與 ${providerName(provider)} 已同步`);
  }
  async function uploadEnvelope(provider,local,remote=null){
    setStatus(`正在上傳至 ${providerName(provider)}…`,'working');
    const result=await writeRemote(provider,local,remote);markSynced(provider,local,result);setStatus(`同步完成：${formatTime(local.updatedAt)}`,'ok');app.toast(`${providerName(provider)} 同步完成`);
  }
  async function applyRemote(provider,remote){
    app.createCloudRollback(providerName(provider));
    app.replaceStateFromCloud(remote.envelope.data,remote.envelope.updatedAt);
    markSynced(provider,remote.envelope,remote.file);
    setStatus(`已載入 ${providerName(provider)}：${formatTime(remote.envelope.updatedAt)}`,'ok');app.toast(`已載入 ${providerName(provider)} 資料`);renderUi();
  }
  function showConflict(provider,local,remote,reason='本機與雲端都有不同內容。'){
    pendingConflict={provider,local,remote};
    const name=providerName(provider),localSummary=app.summarizeState(local.data),remoteSummary=app.summarizeState(remote.envelope.data);
    const rows=[['現金花費','cash'],['信用卡記錄','credit'],['卡費記錄','cardFees'],['家的支出','home'],['分期','installments'],['房貸','mortgage'],['稅費、投資','taxInvest'],['午餐花費','lunch']];
    conflictTitle.textContent=`${name} 同步衝突`;
    conflictMeta.innerHTML=`${escapeHtml(reason)}<br>本機：${escapeHtml(formatTime(local.updatedAt))}；雲端：${escapeHtml(formatTime(remote.envelope.updatedAt))}`;
    conflictComparison.innerHTML=`<table class="import-compare"><thead><tr><th>分頁</th><th>本機</th><th>雲端</th></tr></thead><tbody>${rows.map(([label,key])=>`<tr><td>${label}</td><td>${escapeHtml(localSummary[key])}</td><td>${escapeHtml(remoteSummary[key])}</td></tr>`).join('')}</tbody></table>`;
    conflictPanel.hidden=false;setStatus('偵測到同步衝突，已停止自動覆蓋。','warning');
  }
  function clearConflict(){pendingConflict=null;conflictPanel.hidden=true;}

  async function smartSync(provider,interactive=true){
    if(busy)return;
    const token=await ensureToken(provider,interactive,'smart');
    if(!token){if(!interactive)setStatus(`${providerName(provider)} 尚未登入；本機資料已保留。`,'warning');return;}
    setBusy(true,`正在比較 ${providerName(provider)} 的資料…`);
    try{
      const [local,remote]=await Promise.all([makeEnvelope(),readRemote(provider)]);
      if(!remote){await uploadEnvelope(provider,local,null);clearConflict();return;}
      if(local.dataHash===remote.envelope.dataHash){markSynced(provider,remote.envelope,remote.file);setStatus('本機與雲端內容相同，不需更新。','ok');clearConflict();return;}
      const lastHash=config[provider].lastSyncedHash||'';
      if(!lastHash){showConflict(provider,local,remote,'這是此裝置第一次與既有雲端檔案同步，請選擇要保留哪一份。');return;}
      const localChanged=local.dataHash!==lastHash,remoteChanged=remote.envelope.dataHash!==lastHash;
      if(localChanged&&!remoteChanged){await uploadEnvelope(provider,local,remote);clearConflict();return;}
      if(!localChanged&&remoteChanged){await applyRemote(provider,remote);clearConflict();return;}
      showConflict(provider,local,remote,'本機與雲端都在上次同步後被修改，不能安全地自動合併。');
    }catch(error){setStatus(error.message,'error');if(interactive)alert(error.message);}
    finally{setBusy(false);renderUi();}
  }
  async function forceUpload(provider){
    if(busy)return;const token=await ensureToken(provider,true,'upload');if(!token)return;
    setBusy(true,`正在讀取 ${providerName(provider)}…`);
    try{
      const [local,remote]=await Promise.all([makeEnvelope(),readRemote(provider)]);
      if(remote&&remote.envelope.dataHash!==local.dataHash&&!confirm(`這會用目前本機資料覆蓋 ${providerName(provider)}。確定繼續？`))return;
      await uploadEnvelope(provider,local,remote);clearConflict();
    }catch(error){setStatus(error.message,'error');alert(error.message);}finally{setBusy(false);renderUi();}
  }
  async function forceDownload(provider){
    if(busy)return;const token=await ensureToken(provider,true,'download');if(!token)return;
    setBusy(true,`正在讀取 ${providerName(provider)}…`);
    try{
      const local=await makeEnvelope(),remote=await readRemote(provider);
      if(!remote){setStatus(`${providerName(provider)} 尚無同步檔。`,'warning');return;}
      if(local.dataHash===remote.envelope.dataHash){markSynced(provider,remote.envelope,remote.file);setStatus('本機與雲端內容相同。','ok');return;}
      showConflict(provider,local,remote,'你選擇載入雲端資料。請先比較內容，再決定是否覆蓋本機。');
    }catch(error){setStatus(error.message,'error');alert(error.message);}finally{setBusy(false);renderUi();}
  }

  function openModal(){modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('modal-open');renderUi();}
  function closeModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');if(document.getElementById('importDialog')?.hidden!==false)document.body.classList.remove('modal-open');}

  cloudButton.addEventListener('click',openModal);
  closeButton.addEventListener('click',closeModal);
  modal.addEventListener('click',event=>{if(event.target===modal)closeModal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))closeModal();});

  googleClientIdInput.addEventListener('change',()=>{config.googleClientId=googleClientIdInput.value.trim();googleTokenClient=null;writeSession(GOOGLE_SESSION_KEY,null);saveConfig();});
  microsoftClientIdInput.addEventListener('change',()=>{config.microsoftClientId=microsoftClientIdInput.value.trim();writeSession(MICROSOFT_SESSION_KEY,null);saveConfig();});
  autoSyncInput.addEventListener('change',()=>{config.autoSync=autoSyncInput.checked;saveConfig();});
  activeProviderSelect.addEventListener('change',()=>{config.activeProvider=activeProviderSelect.value;saveConfig();});

  modal.addEventListener('click',async event=>{
    const button=event.target.closest('[data-cloud-action]');if(!button)return;
    const action=button.dataset.cloudAction;
    try{
      if(action==='google-login'){setBusy(true,'正在開啟 Google 登入…');await getGoogleToken(true);setStatus('Google 帳戶連線完成。','ok');}
      if(action==='google-sync')await smartSync('google',true);
      if(action==='google-upload')await forceUpload('google');
      if(action==='google-download')await forceDownload('google');
      if(action==='google-logout')await googleDisconnect();
      if(action==='microsoft-login')await microsoftStartLogin('smart');
      if(action==='microsoft-sync')await smartSync('onedrive',true);
      if(action==='microsoft-upload')await forceUpload('onedrive');
      if(action==='microsoft-download')await forceDownload('onedrive');
      if(action==='microsoft-logout')await microsoftDisconnect();
      if(action==='copy-google-origin'){await navigator.clipboard.writeText(getGoogleOrigin());app.toast('JavaScript origin 已複製');}
      if(action==='copy-redirect'){await navigator.clipboard.writeText(getMicrosoftRedirectUri());app.toast('Redirect URI 已複製');}
      if(action==='conflict-local'&&pendingConflict){const {provider,local,remote}=pendingConflict;setBusy(true,'正在以上傳本機資料解決衝突…');await uploadEnvelope(provider,local,remote);clearConflict();}
      if(action==='conflict-cloud'&&pendingConflict){const {provider,remote}=pendingConflict;if(confirm('確定採用雲端資料並覆蓋本機嗎？App 會保留一份可復原快照。')){setBusy(true,'正在載入雲端資料…');await applyRemote(provider,remote);clearConflict();}}
      if(action==='conflict-cancel')clearConflict();
      if(action==='restore-cloud'){
        const snapshot=app.getCloudRollback();if(!snapshot){alert('找不到可復原資料。');return;}
        if(!confirm(`要復原到 ${formatTime(snapshot.createdAt)} 的雲端載入前狀態嗎？`))return;
        app.downloadJson(app.getState(),`財務追蹤_雲端復原前備份_${app.fileStamp()}.json`);
        app.restoreCloudRollback();config.google.lastSyncedHash='';config.onedrive.lastSyncedHash='';saveConfig();setStatus('已復原雲端載入前資料；下次同步會重新比對。','ok');app.toast('已復原雲端載入前資料');
      }
    }catch(error){setStatus(error.message,'error');alert(error.message);}
    finally{if(action==='google-login'||action==='conflict-local'||action==='conflict-cloud'){setBusy(false);renderUi();}}
  });

  window.addEventListener('finance-tracker-local-saved',()=>{
    if(!config.autoSync||!config.activeProvider)return;
    clearTimeout(autoTimer);autoTimer=setTimeout(()=>smartSync(config.activeProvider,false),3000);
  });
  window.addEventListener('online',()=>{if(config.autoSync&&config.activeProvider)smartSync(config.activeProvider,false);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&config.autoSync&&config.activeProvider)smartSync(config.activeProvider,false);});

  renderUi();
  handleMicrosoftRedirect().catch(error=>{setStatus(error.message,'error');app.toast('Microsoft 登入未完成');openModal();});
})();
