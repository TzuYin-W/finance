(() => {
  'use strict';

  const APP_CONFIG = window.FINANCE_APP_CONFIG || {};
  const STORAGE_KEY = APP_CONFIG.storageKey || 'finance-tracker-2026-v1';
  const IMPORT_ROLLBACK_KEY = `${STORAGE_KEY}-pre-import-backup`;
  const UNDO_KEY = `${STORAGE_KEY}-last-action-undo-v1`;
  const UI_STORAGE_KEY = `${STORAGE_KEY}-ui-state-v1`;
  const CLOUD_ROLLBACK_KEY = `${STORAGE_KEY}-pre-cloud-sync-backup`;
  const TABS = [
    ['cash','現金花費','💵'],['credit','信用卡記錄','💳'],['cardFees','卡費記錄','🧾'],
    ['home','家的支出','🏠'],['installments','分期','💸'],['mortgage','貸款','🏦'],
    ['tax','稅費','🧮'],['investment','投資','📈'],['lunch','午餐花費','🥗'],['settings','設定','⚙️']
  ];
  const CURRENT_SCHEMA = 9;
  const THEMES = [
    {id:'olive',name:'橄欖綠色調',colors:['#7b963f','#eaf2d7','#f5f7f4']},
    {id:'pink',name:'粉色調',colors:['#c97891','#f9e7ed','#fff7fa']},
    {id:'charcoal',name:'黑灰色調',colors:['#4a4f55','#e8eaed','#f1f2f3']},
    {id:'cream',name:'奶油色調',colors:['#b99a63','#f5ead6','#fbf7ef']},
    {id:'white',name:'全白色調',colors:['#5f6b74','#f2f4f5','#ffffff']},
    {id:'pikmin',name:'皮克敏風格',colors:['#34d27a','#fff6dc','#d9e4ea']},
    {id:'pokemon',name:'寶可夢風格',colors:['#4aa8ff','#ef4b4d','#ffd24a']}
  ];
  const ROW_COLORS = [
    {id:'',name:'無'},
    {id:'pink',name:'粉紅'},
    {id:'yellow',name:'淡黃'},
    {id:'blue',name:'淡藍'},
    {id:'green',name:'淡綠'},
    {id:'cream',name:'奶油'},
    {id:'gray',name:'淺灰'}
  ];
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const initial = migrateState(clone(window.INITIAL_FINANCE_DATA));
  let state = loadState();
  let pendingImport = null;
  function loadUiPrefs(){
    try{const x=JSON.parse(localStorage.getItem(UI_STORAGE_KEY)||'{}');return x&&typeof x==='object'?x:{};}catch(_){return {};}
  }
  function saveUiPrefs(){
    try{localStorage.setItem(UI_STORAGE_KEY,JSON.stringify({tab:ui.tab,search:ui.search,page:ui.page,activeCard:ui.activeCard,dateFilters:ui.dateFilters,viewFilters:ui.viewFilters,includeUndated:ui.includeUndated,creditUnpaidOnly:ui.creditUnpaidOnly}));}catch(_){}
  }
  const savedUi=loadUiPrefs();
  const ui = {
    tab: location.hash.slice(1) || savedUi.tab || 'cash',
    search:savedUi.search&&typeof savedUi.search==='object'?savedUi.search:{},
    page:savedUi.page&&typeof savedUi.page==='object'?savedUi.page:{},
    activeCard:Number.isFinite(Number(savedUi.activeCard))?Number(savedUi.activeCard):0,
    dateFilters:savedUi.dateFilters&&typeof savedUi.dateFilters==='object'?savedUi.dateFilters:{},
    viewFilters:Object.assign({cash:{},mortgage:{},tax:{},investment:{}},savedUi.viewFilters&&typeof savedUi.viewFilters==='object'?savedUi.viewFilters:{}),
    includeUndated:Object.assign({cash:false,credit:false},savedUi.includeUndated&&typeof savedUi.includeUndated==='object'?savedUi.includeUndated:{}),
    creditUnpaidOnly:savedUi.creditUnpaidOnly===true,
    cashSelection:new Set(), showAddCard:false, deleteCardIndex:null, revealCashId:null
  };
  if (ui.tab === 'taxInvest') ui.tab = 'tax';
  if (!TABS.some(t => t[0] === ui.tab)) ui.tab = 'cash';

  const nav = document.getElementById('nav');
  const main = document.getElementById('main');
  const pageTitle = document.getElementById('pageTitle');
  const undoDeleteBtn = document.getElementById('undoDeleteBtn');
  const searchInput = document.getElementById('globalSearch');
  const saveStatus = document.getElementById('saveStatus');
  const toastEl = document.getElementById('toast');
  const importDialog = document.getElementById('importDialog');
  const importPreview = document.getElementById('importPreview');
  const confirmImportBtn = document.getElementById('confirmImportBtn');
  const restoreImportBtn = document.getElementById('restoreImportBtn');
  const resetButton = document.querySelector('[data-global-action="reset"]');
  const globalControlHost = document.getElementById('globalControlHost');
  const settingsToolbar = document.getElementById('settingsToolbar');
  const pageSearchBox = document.getElementById('pageSearchBox');
  if(resetButton)resetButton.textContent=APP_CONFIG.resetLabel||'還原原始 Excel';
  let saveTimer;
  let memoryUndo = null;

  function migrateState(source){
    const s = source && typeof source === 'object' ? source : {};
    s.meta = s.meta || {};
    const baseYear = normalizeYear(s.meta.currentYear || s.meta.year) || new Date().getFullYear();
    s.meta.currentYear = baseYear;
    s.meta.year = baseYear;
    s.meta.schemaVersion = CURRENT_SCHEMA;
    if(!s.meta.updatedAt || Number.isNaN(Date.parse(s.meta.updatedAt))) s.meta.updatedAt = new Date().toISOString();
    s.meta.theme = THEMES.some(t=>t.id===s.meta.theme) ? s.meta.theme : 'olive';
    s.meta.fontScale = Math.min(1.30,Math.max(0.85,Number(s.meta.fontScale)||1));
    s.meta.months = Array.isArray(s.meta.months) && s.meta.months.length === 12 ? s.meta.months : ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

    s.cash = s.cash || {accounts:[],transactions:[]};
    s.cash.accounts = Array.isArray(s.cash.accounts) ? s.cash.accounts : [];
    s.cash.transactions = Array.isArray(s.cash.transactions) ? s.cash.transactions : [];
    s.cash.templates = Array.isArray(s.cash.templates) ? s.cash.templates : [];
    s.cash.accounts.forEach(a => {
      a.initialByYear = a.initialByYear && typeof a.initialByYear === 'object' ? a.initialByYear : {};
      a.historyYears = Array.isArray(a.historyYears) ? [...new Set(a.historyYears.map(normalizeYear).filter(Boolean))] : [];
      if(a.initialByYear[String(baseYear)] === undefined) a.initialByYear[String(baseYear)] = Number(a.initial) || 0;
    });
    const applyFutureMonthlyDefault = s.meta.futureMonthlyFlowDefaultVersion !== 1;
    s.cash.transactions.forEach(t => {
      t.id = t.id || uid('cash');
      const hadMonthlyFlow = t.monthlyFlow === 'neutral' || t.monthlyFlow === 'auto';
      t.monthlyFlow = t.monthlyFlow === 'neutral' ? 'neutral' : (!hadMonthlyFlow && t.date && String(t.date) > today() ? 'neutral' : 'auto');
      if(applyFutureMonthlyDefault && t.date && String(t.date) > today()) t.monthlyFlow = 'neutral';
      t.rowColor = validRowColor(t.rowColor);
      if(t.date) t.reportMonth = Number(String(t.date).slice(5,7)) || t.reportMonth || 1;
    });
    if(applyFutureMonthlyDefault) s.meta.futureMonthlyFlowDefaultVersion = 1;

    /* Repair the earlier Excel import where every imported cash row was incorrectly marked neutral. */
    const repairLegacyMonthlyCash = Number(s.meta.cashMonthlyImportRepairVersion || 0) < 1
      && /2026財務追蹤\(3\)\.xlsx$/i.test(String(s.meta.source || ''));
    if(repairLegacyMonthlyCash){
      s.cash.transactions.forEach(t => {
        if(/^cash-\d+$/.test(String(t.id || '')) && legacyImportedCashShouldAuto(t)) t.monthlyFlow = 'auto';
      });
      s.meta.cashMonthlyImportRepairVersion = 1;
    }
    s.cash.templates.forEach(t => { t.reportMode = t.reportMode === 'neutral' ? 'neutral' : 'auto'; });

    s.creditCards = Array.isArray(s.creditCards) ? s.creditCards : [];
    s.creditCards.forEach(card => {
      card.transactions = Array.isArray(card.transactions) ? card.transactions : [];
      card.templates = Array.isArray(card.templates) ? card.templates : [];
      card.historyYears = Array.isArray(card.historyYears) ? [...new Set(card.historyYears.map(normalizeYear).filter(Boolean))] : [];
      card.transactions.forEach(t => { t.id=t.id||uid('cc'); t.date=String(t.date||''); if(typeof t.paid !== 'boolean') t.paid = false; t.monthlyFlow=t.monthlyFlow==='neutral'?'neutral':'auto'; t.rowColor = validRowColor(t.rowColor); });
    });

    s.cardFees = s.cardFees || {};
    s.cardFees.banks = Array.isArray(s.cardFees.banks) ? s.cardFees.banks : [];
    s.cardFees.history = Array.isArray(s.cardFees.history) ? s.cardFees.history : [];
    s.cardFees.monthlyInputs = normalizeMonthlyInputs(s.cardFees.monthlyInputs);
    s.cardFees.yearBooks = s.cardFees.yearBooks && typeof s.cardFees.yearBooks === 'object' ? s.cardFees.yearBooks : {};
    if(!s.cardFees.yearBooks[String(baseYear)]) s.cardFees.yearBooks[String(baseYear)] = {banks:clone(s.cardFees.banks),monthlyInputs:clone(s.cardFees.monthlyInputs)};
    Object.values(s.cardFees.yearBooks).forEach(book => {
      book.banks = Array.isArray(book.banks) ? book.banks : [];
      book.monthlyInputs = normalizeMonthlyInputs(book.monthlyInputs);
    });
    s.cardFees.history.forEach((row,idx) => {
      const y=normalizeYear(row.year); if(!y || s.cardFees.yearBooks[String(y)]) return;
      s.cardFees.yearBooks[String(y)]={banks:[{id:`history-bank-${y}-${idx}`,bank:'歷史總計',months:normalizeMonths(row.months)}],monthlyInputs:normalizeMonthlyInputs([])};
    });

    s.homeExpenses = s.homeExpenses || {};
    s.homeExpenses.items = Array.isArray(s.homeExpenses.items) ? s.homeExpenses.items : [];
    s.homeExpenses.history = Array.isArray(s.homeExpenses.history) ? s.homeExpenses.history : [];
    s.homeExpenses.yearBooks = s.homeExpenses.yearBooks && typeof s.homeExpenses.yearBooks === 'object' ? s.homeExpenses.yearBooks : {};
    if(!s.homeExpenses.yearBooks[String(baseYear)]) s.homeExpenses.yearBooks[String(baseYear)]={items:clone(s.homeExpenses.items)};
    Object.values(s.homeExpenses.yearBooks).forEach(book=>{book.items=Array.isArray(book.items)?book.items:[];book.items.forEach(x=>x.months=normalizeMonths(x.months));});
    s.homeExpenses.history.forEach((row,idx)=>{
      const y=normalizeYear(row.year); if(!y || s.homeExpenses.yearBooks[String(y)]) return;
      s.homeExpenses.yearBooks[String(y)]={items:[{id:`history-home-${y}-${idx}`,item:'歷史總計',months:normalizeMonths(row.months)}]};
    });

    s.installments = Array.isArray(s.installments) ? s.installments : [];
    s.installmentHistory = Array.isArray(s.installmentHistory) ? s.installmentHistory : [];
    s.installments.forEach(it=>{if(!normalizeYear(it.year))it.year=baseYear;});

    s.mortgage = s.mortgage || {accounts:[],payments:[]};
    s.mortgage.accounts = Array.isArray(s.mortgage.accounts) ? s.mortgage.accounts : [];
    s.mortgage.payments = Array.isArray(s.mortgage.payments) ? s.mortgage.payments : [];
    s.mortgage.accounts.forEach(a=>{
      a.loanType = String(a.loanType||'').trim();
      a.note = String(a.note||'');
    });
    s.mortgage.payments.forEach(x=>{
      const acc=s.mortgage.accounts.find(a=>a.name===x.account);
      x.loanType = String(x.loanType || acc?.loanType || '').trim();
    });
    s.taxesInvestments = s.taxesInvestments || {taxes:[],investments:[]};
    s.taxesInvestments.taxes = Array.isArray(s.taxesInvestments.taxes) ? s.taxesInvestments.taxes : [];
    s.taxesInvestments.investments = Array.isArray(s.taxesInvestments.investments) ? s.taxesInvestments.investments : [];
    s.lunch = s.lunch || {products:[],rows:[]};
    s.lunch.products = Array.isArray(s.lunch.products) ? s.lunch.products : [];
    s.lunch.rows = Array.isArray(s.lunch.rows) ? s.lunch.rows : [];
    s.lunch.rows.forEach(r=>{r.location=String(r.location||'');r.costs=r.costs&&typeof r.costs==='object'?r.costs:{}});

    const years = new Set((Array.isArray(s.meta.years)?s.meta.years:[]).map(normalizeYear).filter(Boolean));
    years.add(baseYear);
    s.cash.transactions.forEach(x=>{const y=txYear(x.date);if(y)years.add(y);});
    s.creditCards.forEach(c=>c.transactions.forEach(x=>{const y=txYear(x.date);if(y)years.add(y);}));
    s.mortgage.payments.forEach(x=>{const y=txYear(x.date);if(y)years.add(y);});
    s.installmentHistory.forEach(x=>{const y=txYear(x.completedAt);if(y)years.add(y);});
    s.taxesInvestments.taxes.forEach(x=>{const y=normalizeYear(x.year);if(y)years.add(y);});
    s.taxesInvestments.investments.forEach(a=>a.transactions?.forEach(x=>{const y=txYear(x.date);if(y)years.add(y);}));
    s.lunch.rows.forEach(x=>{const y=txYear(x.date);if(y)years.add(y);});
    Object.keys(s.cardFees.yearBooks).forEach(y=>years.add(Number(y)));
    Object.keys(s.homeExpenses.yearBooks).forEach(y=>years.add(Number(y)));
    s.meta.years=[...years].filter(y=>y>=1900&&y<=2200).sort((a,b)=>b-a);
    sortAllDatedCollections(s);
    return s;
  }
  function loadState(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return migrateState(saved || clone(initial));
    } catch (_) { return migrateState(clone(initial)); }
  }
  function scheduleSave(){
    saveStatus.textContent = '儲存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        state.meta.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        saveStatus.textContent = '已自動儲存於本機';
        window.dispatchEvent(new CustomEvent('finance-tracker-local-saved',{detail:{updatedAt:state.meta.updatedAt}}));
      } catch (err) {
        saveStatus.textContent = '儲存失敗：瀏覽器空間不足';
      }
    }, 220);
  }
  function readUndo(){
    if(memoryUndo?.data)return memoryUndo;
    try{const x=JSON.parse(localStorage.getItem(UNDO_KEY)||'null');return x?.data?x:null;}catch(_){return null;}
  }
  function updateUndoButton(){
    if(!undoDeleteBtn)return;
    const snapshot=readUndo();
    undoDeleteBtn.disabled=!snapshot;
    undoDeleteBtn.title=snapshot?`復原上一步：${snapshot.label||'最近一次操作'}`:'目前沒有可復原的操作';
  }
  function captureUndo(label='修改資料'){
    const snapshot={createdAt:new Date().toISOString(),label,data:clone(state)};
    memoryUndo=snapshot;
    try{localStorage.setItem(UNDO_KEY,JSON.stringify(snapshot));}catch(_){}
    updateUndoButton();
  }
  function clearUndo(){
    memoryUndo=null;
    try{localStorage.removeItem(UNDO_KEY);}catch(_){}
    updateUndoButton();
  }
  function undoLastAction(){
    const snapshot=readUndo();
    if(!snapshot?.data){toast('目前沒有可復原的操作');updateUndoButton();return;}
    state=migrateState(clone(snapshot.data));
    sortAllDatedCollections(state);
    ui.activeCard=Math.max(0,Math.min(ui.activeCard,state.creditCards.length-1));
    ui.cashSelection.clear();
    ui.revealCashId=null;
    clearUndo();
    scheduleSave();
    render();
    toast(`已復原上一步：${snapshot.label||'最近一次操作'}`);
  }
  function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
  function money(v, digits=0){
    return new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:digits,minimumFractionDigits:digits}).format(n(v));
  }
  function plain(v,digits=0){ return new Intl.NumberFormat('zh-TW',{maximumFractionDigits:digits}).format(n(v)); }
  function today(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function fileStamp(){
    const d=new Date(),pad=v=>String(v).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  function uid(prefix='id'){ return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
  function compareDateAscValues(aDate,bDate){
    const a=String(aDate||'').trim(),b=String(bDate||'').trim();
    if(!a&&!b)return 0;
    if(!a)return 1;
    if(!b)return -1;
    return a.localeCompare(b);
  }
  function sortDatedArray(items,key='date'){
    if(Array.isArray(items))items.sort((a,b)=>compareDateAscValues(a?.[key],b?.[key]));
    return items;
  }
  function sortAllDatedCollections(target){
    const s=target&&typeof target==='object'?target:null;if(!s)return;
    sortDatedArray(s.cash?.transactions);
    (s.creditCards||[]).forEach(card=>sortDatedArray(card?.transactions));
    sortDatedArray(s.mortgage?.payments);
    sortDatedArray(s.installmentHistory,'completedAt');
    (s.taxesInvestments?.investments||[]).forEach(asset=>sortDatedArray(asset?.transactions));
    sortDatedArray(s.lunch?.rows);
  }
  function getPath(path){ return path.split('.').reduce((o,k)=>o?.[k], state); }
  function setPath(path,value){
    const parts=path.split('.'); let o=state;
    for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
    o[parts.at(-1)] = value;
  }
  function displayDate(value){
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?`${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`:'';
  }
  function dateControl(value,attrs='',emptyLabel='選擇日期'){
    const raw=String(value||'');
    return `<span class="app-date-control" data-date-empty="${esc(emptyLabel)}"><span class="app-date-display" aria-hidden="true">${esc(displayDate(raw)||emptyLabel)}</span><input type="date" class="app-date-native" value="${esc(raw)}" ${attrs}></span>`;
  }
  function formDateInput(name,value,extra=''){return dateControl(value,`name="${esc(name)}" ${extra}`,'選擇日期');}
  function filterDateInput(key,side,value){return dateControl(value,`data-filter-key="${esc(key)}" data-filter-side="${esc(side)}"`,'不限');}
  function updateDateControlDisplay(inputEl){
    const control=inputEl?.closest?.('.app-date-control');if(!control)return;
    const display=control.querySelector('.app-date-display');if(display)display.textContent=displayDate(inputEl.value)||control.dataset.dateEmpty||'選擇日期';
  }
  function input(path,value,type='text',extra=''){
    const val = value ?? '';
    if(type==='date')return dateControl(val,`data-path="${esc(path)}" ${extra}`,'選擇日期');
    return `<input type="${type}" data-path="${esc(path)}" value="${esc(val)}" ${type==='number'?'step="any"':''} ${extra}>`;
  }
  function textarea(path,value){ return `<textarea data-path="${esc(path)}">${esc(value)}</textarea>`; }
  function select(path,value,options,extra=''){
    return `<select data-path="${esc(path)}" ${extra}>${options.map(o=>{
      const pair=Array.isArray(o)?o:[o,o]; return `<option value="${esc(pair[0])}" ${String(pair[0])===String(value)?'selected':''}>${esc(pair[1])}</option>`;
    }).join('')}</select>`;
  }
  function validRowColor(value){ return ROW_COLORS.some(c=>c.id===String(value||'')) ? String(value||'') : ''; }
  function rowColorOptions(value=''){
    const selected=validRowColor(value);
    return ROW_COLORS.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('');
  }
  function rowColorSelect(path,value){ return `<select class="row-color-select" data-path="${esc(path)}" aria-label="標記顏色">${rowColorOptions(value)}</select>`; }
  function rowColorForm(name,value=''){ return `<select class="row-color-select" name="${esc(name)}" aria-label="標記顏色">${rowColorOptions(value)}</select>`; }

  function normalizeReportMode(value){return value==='neutral'?'neutral':'auto';}
  function reportModeLabel(value){return normalizeReportMode(value)==='neutral'?'不列入月報':'依正負號';}
  function reportModeIcon(value){
    if(normalizeReportMode(value)==='neutral')return `<svg class="report-neutral-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="27" height="27" rx="7"></rect><path d="M9 9l14 14M23 9L9 23"></path></svg>`;
    return `<svg class="report-plus-minus-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="27" height="27" rx="7"></rect><path d="M10 7.5v8M6 11.5h8M18.5 22h8M8 25L24 7"></path></svg>`;
  }
  function reportModeToggle(path,value){
    const mode=normalizeReportMode(value),label=reportModeLabel(mode);
    return `<button type="button" class="report-mode-toggle ${mode}" data-action="toggle-report-mode" data-path="${esc(path)}" data-mode="${mode}" title="${esc(label)}" aria-label="${esc(label)}">${reportModeIcon(mode)}</button>`;
  }

  function toast(msg){
    toastEl.textContent=msg; toastEl.classList.add('show');
    setTimeout(()=>toastEl.classList.remove('show'),1700);
  }
  function downloadJson(data,filename){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function formatBytes(bytes){
    const value=Number(bytes)||0;if(value<1024)return `${value} B`;
    if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;
    return `${(value/1024/1024).toFixed(1)} MB`;
  }
  function backupValidation(raw){
    const errors=[];
    if(!raw||typeof raw!=='object'||Array.isArray(raw))errors.push('檔案內容不是有效的資料物件。');
    if(!raw?.meta||typeof raw.meta!=='object'||Array.isArray(raw.meta))errors.push('缺少備份版本與年度資訊（meta）。');
    if(!raw?.cash||typeof raw.cash!=='object'||Array.isArray(raw.cash))errors.push('缺少現金花費資料結構（cash）。');
    if(raw?.cash?.accounts!==undefined&&!Array.isArray(raw.cash.accounts))errors.push('現金帳戶格式不正確。');
    if(raw?.cash?.transactions!==undefined&&!Array.isArray(raw.cash.transactions))errors.push('現金交易格式不正確。');
    if(raw?.creditCards!==undefined&&!Array.isArray(raw.creditCards))errors.push('信用卡資料格式不正確。');
    if(raw?.installments!==undefined&&!Array.isArray(raw.installments))errors.push('分期資料格式不正確。');
    const known=['creditCards','cardFees','homeExpenses','installments','mortgage','taxesInvestments','lunch'];
    if(raw&&typeof raw==='object'&&!known.some(k=>Object.prototype.hasOwnProperty.call(raw,k)))errors.push('內容不像財務追蹤 App 的完整備份。');
    const schemaRaw=Number(raw?.meta?.schemaVersion);
    const sourceSchema=Number.isFinite(schemaRaw)?schemaRaw:null;
    const newer=sourceSchema!==null&&sourceSchema>CURRENT_SCHEMA;
    if(newer)errors.push(`此備份版本為 ${sourceSchema}，高於目前 App 支援的版本 ${CURRENT_SCHEMA}。請先使用較新的 App。`);
    return {errors,sourceSchema,newer,compatible:errors.length===0};
  }
  function backupSummary(s){
    const cardTransactions=sum(s.creditCards||[],c=>(c.transactions||[]).length);
    const cardTemplates=sum(s.creditCards||[],c=>(c.templates||[]).length);
    const cardFeeBooks=Object.values(s.cardFees?.yearBooks||{});
    const homeBooks=Object.values(s.homeExpenses?.yearBooks||{});
    const investmentTransactions=sum(s.taxesInvestments?.investments||[],a=>(a.transactions||[]).length);
    return {
      cash:`${(s.cash?.accounts||[]).length} 個帳戶／${(s.cash?.transactions||[]).length} 筆交易／${(s.cash?.templates||[]).length} 個模板`,
      credit:`${(s.creditCards||[]).length} 個卡別／${cardTransactions} 筆交易／${cardTemplates} 個模板`,
      cardFees:`${cardFeeBooks.length} 個年度／${sum(cardFeeBooks,b=>(b.banks||[]).length)} 個卡費項目`,
      home:`${homeBooks.length} 個年度／${sum(homeBooks,b=>(b.items||[]).length)} 個支出項目`,
      installments:`${(s.installments||[]).length} 筆進行中／${(s.installmentHistory||[]).length} 筆歷史`,
      mortgage:`${(s.mortgage?.accounts||[]).length} 組貸款／${(s.mortgage?.payments||[]).length} 筆還款`,
      tax:`${(s.taxesInvestments?.taxes||[]).length} 筆稅費`,
      investment:`${(s.taxesInvestments?.investments||[]).length} 項投資／${investmentTransactions} 筆投資紀錄`,
      lunch:`${(s.lunch?.products||[]).length} 個品項／${(s.lunch?.rows||[]).length} 筆紀錄`
    };
  }
  function isHistoryMergePackage(raw){
    return String(raw?.meta?.importMode||'').toLowerCase()==='history-merge';
  }
  function historicalPackageYears(raw){
    const preserve=normalizeYear(raw?.meta?.preserveFromYear)||2026;
    const src=Array.isArray(raw?.meta?.historicalYears)?raw.meta.historicalYears:(raw?.meta?.years||[]);
    return [...new Set(src.map(normalizeYear).filter(y=>y&&y<preserve))].sort((a,b)=>a-b);
  }
  function normalizedBankKey(value){
    const s=String(value||'').trim();
    for(const name of ['富邦','國泰','永豐','聯邦','台新','中信','第一','玉山','星展','花旗','兆豐'])if(s.includes(name))return name;
    return s.replace(/[\d,（(].*$/,'').trim()||s;
  }
  function historyCashSignature(t){return [t?.date||'',t?.category||'',t?.description||'',n(t?.amount),t?.account||''].join('\u241f');}
  function historyCreditSignature(t){return [t?.date||'',t?.description||'',n(t?.amount),t?.store||'',t?.card||'',n(t?.fee)].join('\u241f');}
  function historyMortgageSignature(t){return [t?.date||'',t?.description||'',n(t?.amount),t?.account||''].join('\u241f');}
  function historyInstallmentSignature(t){return [normalizeYear(t?.year)||'',t?.title||'',n(t?.total),t?.account||'',JSON.stringify(t?.plans||[])].join('\u241f');}
  function historyAccountAvailableInYear(account,year=currentYear()){
    const years=Array.isArray(account?.historyYears)?account.historyYears.map(normalizeYear).filter(Boolean):[];
    return years.length===0||years.includes(Number(year));
  }
  function creditCardAvailableInYear(card,year=currentYear()){
    const years=Array.isArray(card?.historyYears)?card.historyYears.map(normalizeYear).filter(Boolean):[];
    return years.length===0||years.includes(Number(year));
  }
  function mergeHistoricalPackage(base,raw){
    const target=migrateState(clone(base));
    const incoming=migrateState(clone(raw));
    const originalCurrent=normalizeYear(base?.meta?.currentYear||base?.meta?.year)||currentYear();
    const originalTheme=base?.meta?.theme, originalFontScale=base?.meta?.fontScale;
    const years=historicalPackageYears(raw), allowed=new Set(years), preserve=normalizeYear(raw?.meta?.preserveFromYear)||2026;
    const allowedDate=d=>{const y=txYear(d);return Boolean(y&&allowed.has(y)&&y<preserve);};
    const stats={cash:0,credit:0,cardFeeYears:0,homeYears:0,installments:0,mortgage:0,tax:0,investment:0,lunch:0};

    // Cash accounts: write only historical opening balances. Old-only accounts are hidden outside their historical years.
    (incoming.cash?.accounts||[]).forEach(src=>{
      const histYears=Object.keys(src.initialByYear||{}).map(normalizeYear).filter(y=>allowed.has(y));
      if(!histYears.length)return;
      let dest=target.cash.accounts.find(a=>String(a.name||'').trim()===String(src.name||'').trim());
      if(!dest){
        dest=clone(src);dest.id=uid('histacc');dest.initial=0;dest.initialByYear={};dest.historyYears=[...histYears];
        target.cash.accounts.push(dest);
      }
      dest.initialByYear=dest.initialByYear&&typeof dest.initialByYear==='object'?dest.initialByYear:{};
      histYears.forEach(y=>{dest.initialByYear[String(y)]=n(src.initialByYear?.[String(y)]);});
    });
    const cashSeen=new Set((target.cash.transactions||[]).map(historyCashSignature));
    (incoming.cash?.transactions||[]).forEach(src=>{
      if(!allowedDate(src.date))return;const sig=historyCashSignature(src);if(cashSeen.has(sig))return;
      const row=clone(src);row.id=uid('histcash');row.sourceKey=row.sourceKey||sig;target.cash.transactions.push(row);cashSeen.add(sig);stats.cash++;
    });

    // Credit: merge by bank. Historical-only banks are visible only in years that contain their transactions.
    (incoming.creditCards||[]).forEach(srcCard=>{
      const rows=(srcCard.transactions||[]).filter(t=>allowedDate(t.date));if(!rows.length)return;
      const key=normalizedBankKey(srcCard.mergeKey||srcCard.bank||srcCard.title);
      let dest=target.creditCards.find(c=>normalizedBankKey(c.bank||c.title)===key);
      if(!dest){dest={id:uid('histcard'),bank:key,title:srcCard.title||key,limit:n(srcCard.limit),transactions:[],templates:[],historyYears:[...new Set(rows.map(t=>txYear(t.date)).filter(Boolean))]};target.creditCards.push(dest);}
      const seen=new Set((dest.transactions||[]).map(historyCreditSignature));
      rows.forEach(src=>{const sig=historyCreditSignature(src);if(seen.has(sig))return;const row=clone(src);row.id=uid('histcc');row.paid=true;dest.transactions.push(row);seen.add(sig);stats.credit++;});
    });

    // Historical year books never touch the current/future year.
    years.forEach(y=>{
      const fee=incoming.cardFees?.yearBooks?.[String(y)];if(fee){target.cardFees.yearBooks[String(y)]=clone(fee);stats.cardFeeYears++;}
      const home=incoming.homeExpenses?.yearBooks?.[String(y)];if(home){target.homeExpenses.yearBooks[String(y)]=clone(home);stats.homeYears++;}
    });

    const instSeen=new Set((target.installments||[]).map(historyInstallmentSignature));
    (incoming.installments||[]).forEach(src=>{const y=normalizeYear(src.year);if(!allowed.has(y))return;const sig=historyInstallmentSignature(src);if(instSeen.has(sig))return;const row=clone(src);row.id=uid('histinst');target.installments.push(row);instSeen.add(sig);stats.installments++;});

    // Mortgage: preserve existing account definitions; add only missing historical account names.
    (incoming.mortgage?.accounts||[]).forEach(src=>{if(target.mortgage.accounts.some(a=>String(a.name||'').trim()===String(src.name||'').trim()))return;const row=clone(src);row.id=uid('histmortacc');row.historyYears=[...years];target.mortgage.accounts.push(row);});
    const mortSeen=new Set((target.mortgage.payments||[]).map(historyMortgageSignature));
    (incoming.mortgage?.payments||[]).forEach(src=>{if(!allowedDate(src.date))return;const sig=historyMortgageSignature(src);if(mortSeen.has(sig))return;const row=clone(src);row.id=uid('histmort');target.mortgage.payments.push(row);mortSeen.add(sig);stats.mortgage++;});

    // Taxes: Excel history is authoritative only for the historical year and cannot alter 2026+.
    (incoming.taxesInvestments?.taxes||[]).forEach(src=>{const y=gregorianYear(src.year);if(!allowed.has(y))return;const idx=target.taxesInvestments.taxes.findIndex(x=>gregorianYear(x.year)===y);const row=clone(src);row.year=y;if(idx>=0)target.taxesInvestments.taxes[idx]=row;else target.taxesInvestments.taxes.push(row);stats.tax++;});
    (incoming.taxesInvestments?.investments||[]).forEach(srcAsset=>{
      let dest=target.taxesInvestments.investments.find(a=>String(a.name||'').trim()===String(srcAsset.name||'').trim());
      if(!dest){dest={id:uid('histasset'),name:srcAsset.name,transactions:[]};target.taxesInvestments.investments.push(dest);}
      const seen=new Set((dest.transactions||[]).map(t=>[t.date||'',n(t.amount)].join('\u241f')));
      (srcAsset.transactions||[]).forEach(src=>{if(!allowedDate(src.date))return;const sig=[src.date||'',n(src.amount)].join('\u241f');if(seen.has(sig))return;const row=clone(src);row.id=uid('histinvest');dest.transactions.push(row);seen.add(sig);stats.investment++;});
    });

    // Lunch products are matched by name, then historical row costs are remapped to the current product keys.
    const targetProductByName=new Map((target.lunch.products||[]).map(p=>[String(p.name||'').trim(),p]));
    const keyMap={};
    (incoming.lunch?.products||[]).forEach(p=>{const name=String(p.name||'').trim();if(!name)return;let dest=targetProductByName.get(name);if(!dest){dest={key:uid('histp').replaceAll('-','_'),name};target.lunch.products.push(dest);targetProductByName.set(name,dest);(target.lunch.rows||[]).forEach(r=>{r.costs=r.costs||{};r.costs[dest.key]=0;});}keyMap[p.key]=dest.key;});
    const lunchSig=r=>{const parts=[r.date||'',r.location||''];[...(target.lunch.products||[])].sort((a,b)=>String(a.name).localeCompare(String(b.name))).forEach(p=>parts.push(`${p.name}:${n(r.costs?.[p.key])}`));return parts.join('\u241f');};
    const lunchSeen=new Set((target.lunch.rows||[]).map(lunchSig));
    (incoming.lunch?.rows||[]).forEach(src=>{if(!allowedDate(src.date))return;const costs=Object.fromEntries((target.lunch.products||[]).map(p=>[p.key,0]));Object.entries(src.costs||{}).forEach(([oldKey,val])=>{const newKey=keyMap[oldKey];if(newKey)costs[newKey]=n(val);});const row={id:uid('histlunch'),date:src.date,location:src.location||'',costs};const sig=lunchSig(row);if(lunchSeen.has(sig))return;target.lunch.rows.push(row);lunchSeen.add(sig);stats.lunch++;});

    target.meta.currentYear=originalCurrent;target.meta.year=originalCurrent;if(originalTheme)target.meta.theme=originalTheme;if(originalFontScale)target.meta.fontScale=originalFontScale;
    target.meta.historyMerge={source:raw?.meta?.source||'歷史資料合併包',years,mergedAt:new Date().toISOString(),stats};
    target.meta.years=[...new Set([...(target.meta.years||[]),...years,originalCurrent])].map(normalizeYear).filter(Boolean).sort((a,b)=>b-a);
    return {state:migrateState(target),stats,years};
  }

  function closeImportDialog(clear=true){
    if(importDialog)importDialog.hidden=true;
    document.body.classList.remove('modal-open');
    if(clear)pendingImport=null;
  }
  function showImportPreview(){
    if(!pendingImport||!importDialog||!importPreview)return;
    const p=pendingImport,v=p.validation,cur=backupSummary(state),inc=backupSummary(p.normalized);
    const historyMode=p.mode==='history-merge'||isHistoryMergePackage(p.raw);
    const rows=[['現金花費','cash'],['信用卡記錄','credit'],['卡費記錄','cardFees'],['家的支出','home'],['分期','installments'],['貸款','mortgage'],['稅費','tax'],['投資','investment'],['午餐花費','lunch']];
    const sourceVersion=v.sourceSchema===null?'未標示':String(v.sourceSchema);
    let statusClass='ok',statusText=`版本相容：可匯入至目前版本 ${CURRENT_SCHEMA}。`;
    if(v.sourceSchema===null){statusClass='warn';statusText=`舊版備份未標示版本，將先轉換為目前資料格式 ${CURRENT_SCHEMA}。`; }
    else if(v.sourceSchema<CURRENT_SCHEMA){statusClass='warn';statusText=`將由資料版本 ${v.sourceSchema} 升級為 ${CURRENT_SCHEMA}。`; }
    if(!v.compatible){statusClass='block';statusText='此檔案目前不能安全匯入。';}
    importPreview.innerHTML=`
      <div class="import-file-meta">
        <div><span>檔案</span><strong>${esc(p.fileName)}</strong></div>
        <div><span>資料版本</span><strong>${esc(sourceVersion)} → ${CURRENT_SCHEMA}</strong></div>
        <div><span>匯入年份</span><strong>${esc((p.normalized.meta?.years||[]).join('、')||'未辨識')}</strong></div>
      </div>
      <div class="import-status ${statusClass}">${esc(statusText)}${v.errors.length?`<ul class="import-error-list">${v.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</div>
      <div class="import-notice">${historyMode?`<strong>這是歷史年度合併匯入。</strong>只會合併 ${esc(historicalPackageYears(p.raw).join('、'))} 年資料，${esc(p.raw?.meta?.preserveFromYear||2026)} 年及之後的現有資料不會被覆蓋；重複交易會自動略過。`:`<strong>這是覆蓋匯入，不是合併。</strong>確認後會先下載目前帳本的「匯入前自動備份」，並在瀏覽器保留一份可由「復原匯入前」取回的快照；在確認之前，現有資料不會被改動。`}</div>
      <div class="table-wrap"><table class="import-compare"><thead><tr><th>分頁</th><th>目前帳本</th><th>匯入檔</th></tr></thead><tbody>${rows.map(([label,key])=>`<tr><td>${label}</td><td>${esc(cur[key])}</td><td>${esc(inc[key])}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">檔案大小：${esc(formatBytes(p.fileSize))}；備份來源：${esc(p.normalized.meta?.source||'未標示')}；匯入後目前年度：${esc(p.normalized.meta?.currentYear||p.normalized.meta?.year||'未辨識')}。</p>`;
    confirmImportBtn.disabled=!v.compatible;
    confirmImportBtn.textContent=v.compatible?(historyMode?'先備份目前資料並合併歷史年度':'先備份目前資料並覆蓋'):'版本不相容，無法匯入';
    importDialog.hidden=false;document.body.classList.add('modal-open');
    setTimeout(()=>v.compatible?confirmImportBtn.focus():importDialog.querySelector('[data-import-action="cancel"]')?.focus(),0);
  }
  function performSafeImport(){
    if(!pendingImport?.validation?.compatible)return;
    const before=clone(state);
    const historyMode=pendingImport.mode==='history-merge'||isHistoryMergePackage(pendingImport.raw);
    const rollback={createdAt:new Date().toISOString(),sourceFile:pendingImport.fileName,data:before};
    try{
      localStorage.setItem(IMPORT_ROLLBACK_KEY,JSON.stringify(rollback));
    }catch(err){
      alert('無法建立匯入前快照，為避免資料風險，本次匯入已取消。請先下載備份並清理瀏覽器儲存空間。');
      return;
    }
    downloadJson(before,`財務追蹤_匯入前自動備份_${fileStamp()}.json`);
    try{
      if(historyMode){
        const merged=mergeHistoricalPackage(before,pendingImport.raw);
        captureUndo('匯入歷史年度');
        localStorage.setItem(STORAGE_KEY,JSON.stringify(merged.state));
        state=merged.state;ui.page={};ui.showAddCard=false;ui.deleteCardIndex=null;
        closeImportDialog();render();saveStatus.textContent='歷史年度合併完成並已儲存';toast(`已合併 ${merged.years.join('、')} 歷史資料，2026 資料已保留`);
      }else{
        const incoming=migrateState(clone(pendingImport.raw));
        captureUndo('安全匯入資料');
        localStorage.setItem(STORAGE_KEY,JSON.stringify(incoming));
        state=incoming;ui.dateFilters={};ui.page={};ui.activeCard=0;ui.showAddCard=false;ui.deleteCardIndex=null;
        closeImportDialog();render();saveStatus.textContent='安全匯入完成並已儲存';toast('安全匯入完成，可復原匯入前資料');
      }
    }catch(err){
      state=before;
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(before));}catch(_){}
      alert('匯入過程發生錯誤，原資料已保留，未套用匯入檔。');
    }
  }
  function restorePreImport(){
    let snapshot;
    try{snapshot=JSON.parse(localStorage.getItem(IMPORT_ROLLBACK_KEY)||'null');}catch(_){snapshot=null;}
    if(!snapshot?.data){alert('找不到可復原的匯入前資料。');return;}
    const when=snapshot.createdAt?new Date(snapshot.createdAt).toLocaleString('zh-TW'):'先前';
    if(!confirm(`要復原到 ${when} 的匯入前狀態嗎？目前資料會先自動下載一份備份。`))return;
    const current=clone(state);downloadJson(current,`財務追蹤_復原前自動備份_${fileStamp()}.json`);
    try{
      const restored=migrateState(clone(snapshot.data));
      captureUndo('復原匯入前資料');
      localStorage.setItem(STORAGE_KEY,JSON.stringify(restored));
      state=restored;localStorage.removeItem(IMPORT_ROLLBACK_KEY);
      ui.dateFilters={};ui.page={};ui.activeCard=0;ui.showAddCard=false;ui.deleteCardIndex=null;
      render();saveStatus.textContent='已復原匯入前資料';toast('已復原匯入前資料');
    }catch(err){
      state=current;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(current));}catch(_){}
      alert('復原失敗，目前資料未變更。');
    }
  }
  function sum(arr,fn=x=>x){ return arr.reduce((a,x)=>a+n(fn(x)),0); }
  function includesText(item, q){ return JSON.stringify(item).toLowerCase().includes(q.toLowerCase()); }
  function dataRows(items,q){ return items.map((item,index)=>({item,index})).filter(x=>!q || includesText(x.item,q)); }
  function paged(rows,key,per=60){
    const max=Math.max(1,Math.ceil(rows.length/per)); const page=Math.min(Math.max(1,ui.page[key]||1),max); ui.page[key]=page;
    return {rows:rows.slice((page-1)*per,page*per),page,max,total:rows.length};
  }
  function pager(key,p){
    if(p.max<=1) return '';
    return `<div class="pager no-print"><button class="small" data-action="page" data-key="${esc(key)}" data-page="${p.page-1}" ${p.page<=1?'disabled':''}>上一頁</button><span>${p.page} / ${p.max}（${p.total} 筆）</span><button class="small" data-action="page" data-key="${esc(key)}" data-page="${p.page+1}" ${p.page>=p.max?'disabled':''}>下一頁</button></div>`;
  }
  function empty(cols,msg='目前沒有資料'){ return `<tr><td colspan="${cols}" class="empty">${esc(msg)}</td></tr>`; }

  function checkbox(path,checked,label=''){
    return `<label class="check-label"><input type="checkbox" data-path="${esc(path)}" ${checked?'checked':''}>${label?`<span>${esc(label)}</span>`:''}</label>`;
  }
  function legacyImportedCashShouldAuto(t){
    const date=String(t?.date||'').trim();
    if(!date || date > today() || n(t?.amount)===0) return false;
    const category=String(t?.category||'').trim();
    if(['卡費','轉存','家用支出','其他'].includes(category)) return false;
    const account=String(t?.account||'');
    if(/英鎊|日幣|美金|美元|JPY|GBP|USD|EUR|歐元/i.test(account)) return false;
    return true;
  }
  function cashFlow(t){
    if(t.monthlyFlow === 'neutral') return 'neutral';
    return n(t.amount) > 0 ? 'expense' : n(t.amount) < 0 ? 'income' : 'neutral';
  }
  function dateInRange(date,from,to){
    if(!date) return !from && !to;
    return (!from || date >= from) && (!to || date <= to);
  }
  function filteredDataRows(items,q,key,dateFn=x=>x.date,includeUndated=false){
    const f=ui.dateFilters[key]||{};
    return dataRows(items,q).filter(({item})=>{const date=String(dateFn(item)||'').trim();return date?dateInRange(date,f.from,f.to):!!includeUndated;}).sort((a,b)=>compareDateAscValues(dateFn(a.item),dateFn(b.item)));
  }
  function undatedToggle(scope){
    if(!scope)return '';
    const checked=!!ui.includeUndated?.[scope];
    return `<label class="include-undated-toggle"><span class="undated-field-label">空白日期</span><span class="undated-check-control"><input type="checkbox" data-include-undated-scope="${esc(scope)}" ${checked?'checked':''}><span>納入總計</span></span></label>`;
  }
  function dateFilterBar(key,undatedScope='',extraControls=''){
    const f=ui.dateFilters[key]||{};
    return `<div class="filter-bar date-filter-bar ${esc(key)}-date-filter-bar ${undatedScope?`${esc(undatedScope)}-date-filter-bar`:''} no-print"><strong>日期篩選</strong><label>起日${filterDateInput(key,'from',f.from||'')}</label><label>迄日${filterDateInput(key,'to',f.to||'')}</label>${undatedToggle(undatedScope)}${extraControls}<button class="small" data-action="clear-date-filter" data-key="${esc(key)}">清除</button></div>`;
  }

  function uniqueStrings(values){
    return [...new Set((values||[]).map(v=>String(v??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  }
  function uniqueYears(values){
    return [...new Set((values||[]).map(normalizeYear).filter(Number.isFinite))].sort((a,b)=>b-a);
  }
  function viewFilterValue(page,field){ return String(ui.viewFilters?.[page]?.[field] ?? ''); }
  function viewFilterSelect(page,field,label,value,options){
    return `<label>${esc(label)}<select data-view-filter-page="${esc(page)}" data-view-filter-field="${esc(field)}">${options.map(o=>{const pair=Array.isArray(o)?o:[o,o];return `<option value="${esc(pair[0])}" ${String(pair[0])===String(value)?'selected':''}>${esc(pair[1])}</option>`;}).join('')}</select></label>`;
  }
  function viewFilterBar(page,controls){
    return `<div class="filter-bar view-filter-bar ${esc(page)}-view-filter-bar no-print"><strong>顯示篩選</strong>${controls}<button class="small" data-action="clear-view-filters" data-page="${esc(page)}">清除篩選</button></div>`;
  }

  function fillForm(formName,values){
    const form=main.querySelector(`form[data-form="${formName}"]`); if(!form)return;
    Object.entries(values).forEach(([name,value])=>{const el=form.elements.namedItem(name);if(el)el.value=value??'';});
    form.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function copyText(text){
    if(navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(()=>toast('已複製'));
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('已複製');
  }
  function normalizeYear(value){
    const raw=String(value??'').trim(); const digits=Number((raw.match(/\d{3,4}/)||[])[0]);
    if(!Number.isFinite(digits))return NaN; return digits < 1911 ? digits + 1911 : digits;
  }
  function gregorianYear(value){ return normalizeYear(value); }
  function txYear(date){ const y=Number(String(date||'').slice(0,4)); return Number.isFinite(y)?y:NaN; }
  function normalizeMonths(months){return Array.from({length:12},(_,i)=>Number(months?.[i])||0);}
  function normalizeMonthlyInputs(rows){
    return Array.from({length:12},(_,i)=>{
      const r=Array.isArray(rows)?(rows.find(x=>Number(x?.month)===i+1)||rows[i]||{}):{};
      return {month:i+1,salary:Number(r.salary)||0,musicSalary:Number(r.musicSalary)||0};
    });
  }
  function currentYear(){return normalizeYear(state?.meta?.currentYear||state?.meta?.year)||new Date().getFullYear();}
  function yearMatch(date,year=currentYear()){return txYear(date)===Number(year);}
  function defaultDateForYear(){const y=currentYear(),now=today();return txYear(now)===y?now:`${y}-01-01`;}
  function normalizeDateValue(value,fallback=defaultDateForYear()){
    const raw=String(value||'').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
    const parsed=new Date(raw);
    if(!Number.isNaN(parsed.getTime())){
      const y=parsed.getFullYear(),m=String(parsed.getMonth()+1).padStart(2,'0'),d=String(parsed.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }
    return fallback;
  }
  function yearTotals(transactions){
    const map={}; transactions.forEach(t=>{const y=txYear(t.date);if(Number.isFinite(y))map[y]=(map[y]||0)+n(t.amount);});
    return Object.entries(map).sort((a,b)=>Number(b[0])-Number(a[0]));
  }
  function ensureYearStructure(year=currentYear()){
    const y=normalizeYear(year); if(!y)return;
    state.meta.years=Array.from(new Set([...(state.meta.years||[]),y])).sort((a,b)=>b-a);
    state.cardFees.yearBooks=state.cardFees.yearBooks||{};
    if(!state.cardFees.yearBooks[String(y)]){
      const source=state.cardFees.yearBooks[String(currentYear())]||Object.values(state.cardFees.yearBooks)[0]||{banks:[],monthlyInputs:[]};
      state.cardFees.yearBooks[String(y)]={banks:(source.banks||[]).map((b,i)=>({id:uid(`bank${y}${i}`),bank:b.bank,months:Array(12).fill(0)})),monthlyInputs:normalizeMonthlyInputs([])};
    }
    state.homeExpenses.yearBooks=state.homeExpenses.yearBooks||{};
    if(!state.homeExpenses.yearBooks[String(y)]){
      const source=state.homeExpenses.yearBooks[String(currentYear())]||Object.values(state.homeExpenses.yearBooks)[0]||{items:[]};
      state.homeExpenses.yearBooks[String(y)]={items:(source.items||[]).map((x,i)=>({id:uid(`home${y}${i}`),item:x.item,months:Array(12).fill(0)}))};
    }
    state.cash.accounts.forEach(a=>{
      a.initialByYear=a.initialByYear||{};
      if(a.initialByYear[String(y)]!==undefined)return;
      const prev=y-1;
      if(a.initialByYear[String(prev)]!==undefined){
        const movement=sum(state.cash.transactions.filter(t=>t.account===a.name&&yearMatch(t.date,prev)),t=>t.amount);
        a.initialByYear[String(y)]=n(a.initialByYear[String(prev)])-movement;
      } else a.initialByYear[String(y)]=0;
    });
  }
  function currentCardFeeBook(){ensureYearStructure();return state.cardFees.yearBooks[String(currentYear())];}
  function currentHomeBook(){ensureYearStructure();return state.homeExpenses.yearBooks[String(currentYear())];}
  function availableYears(){return Array.from(new Set([...(state.meta.years||[]),currentYear()])).sort((a,b)=>b-a);}
  function currentYearRows(items,dateFn=x=>x.date){return items.map((item,index)=>({item,index})).filter(({item})=>yearMatch(dateFn(item)));}

  function applyTheme(){
    const theme=THEMES.some(t=>t.id===state.meta.theme)?state.meta.theme:'olive';
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.setProperty('--app-font-scale',String(Math.min(1.30,Math.max(0.85,Number(state.meta.fontScale)||1))));
    const meta=document.querySelector('meta[name="theme-color"]');
    const themeInfo=THEMES.find(t=>t.id===theme)||THEMES[0];
    if(meta)meta.setAttribute('content',themeInfo.colors[0]);
  }
  function creditCardCreateForm(){
    return `<section class="card no-print card-manager-card">
      <div class="section-head"><div><h2>新增卡別</h2><p>輸入銀行、顯示名稱與額度後建立；不使用瀏覽器彈出視窗。</p></div><button type="button" data-action="cancel-add-card">取消</button></div>
      <form class="form-grid credit-card-create-form compact-entry-form" data-form="credit-card">
        <div class="field"><label>銀行</label><input name="bank" placeholder="例如：國泰" required autofocus></div>
        <div class="field wide"><label>顯示名稱</label><input name="title" placeholder="例如：國泰 CUBE（每月 3 日結帳）" required></div>
        <div class="field"><label>額度</label><input name="limit" type="number" step="any" value="0"></div>
        <button class="primary" type="submit">建立卡別</button>
      </form>
    </section>`;
  }

  function stashGlobalControls(){
    if(!globalControlHost)return;
    if(saveStatus&&saveStatus.parentElement!==globalControlHost)globalControlHost.appendChild(saveStatus);
    if(settingsToolbar&&settingsToolbar.parentElement!==globalControlHost)globalControlHost.appendChild(settingsToolbar);
    if(pageSearchBox&&pageSearchBox.parentElement!==globalControlHost)globalControlHost.appendChild(pageSearchBox);
  }
  function placeGlobalControls(){
    if(ui.tab==='settings'){
      const slot=document.getElementById('settingsUtilitySlot');
      if(slot){slot.appendChild(saveStatus);slot.appendChild(settingsToolbar);}
    }else{
      const slot=document.getElementById('pageSearchSlot');
      if(slot)slot.appendChild(pageSearchBox);
    }
  }
  function renderNav(){
    nav.innerHTML=TABS.map(([id,label,icon])=>`<button class="nav-btn ${ui.tab===id?'active':''}" data-tab="${id}"><span>${icon}</span>${label}</button>`).join('');
  }
  function renderPreservingAnchor(source,afterRender){
    const top=source?.getBoundingClientRect?.().top;
    const scrollY=window.scrollY;
    const wrap=source?.closest?.('.table-wrap');
    const wrapLeft=wrap?.scrollLeft||0;
    const anchor={
      path:source?.dataset?.path||'',
      filterKey:source?.dataset?.filterKey||'',
      filterSide:source?.dataset?.filterSide||'',
      viewPage:source?.dataset?.viewFilterPage||'',
      viewField:source?.dataset?.viewFilterField||'',
      settingTheme:source?.dataset?.settingTheme!==undefined,
      settingYear:source?.dataset?.settingYear!==undefined
    };
    render();
    requestAnimationFrame(()=>{
      const candidates=[...main.querySelectorAll('input,select,textarea')];
      let next=null;
      if(anchor.path)next=candidates.find(x=>x.dataset.path===anchor.path);
      else if(anchor.filterKey)next=candidates.find(x=>x.dataset.filterKey===anchor.filterKey&&x.dataset.filterSide===anchor.filterSide);
      else if(anchor.viewPage)next=candidates.find(x=>x.dataset.viewFilterPage===anchor.viewPage&&x.dataset.viewFilterField===anchor.viewField);
      else if(anchor.settingTheme)next=candidates.find(x=>x.dataset.settingTheme!==undefined);
      else if(anchor.settingYear)next=candidates.find(x=>x.dataset.settingYear!==undefined);
      if(next&&Number.isFinite(top)){
        const delta=next.getBoundingClientRect().top-top;
        if(Math.abs(delta)>.5)window.scrollBy(0,delta);
        const nextWrap=next.closest('.table-wrap');if(nextWrap)nextWrap.scrollLeft=wrapLeft;
      }else window.scrollTo(0,scrollY);
      if(typeof afterRender==='function')afterRender(next);
    });
  }
  function render(){
    stashGlobalControls();
    applyTheme();
    if(restoreImportBtn)restoreImportBtn.hidden=!localStorage.getItem(IMPORT_ROLLBACK_KEY);
    updateUndoButton();
    renderNav();
    const tab=TABS.find(t=>t[0]===ui.tab);
    const year=currentYear();
    pageTitle.textContent=ui.tab==='settings'?'設定':(['mortgage','tax','investment'].includes(ui.tab)?tab[1]:`${year}${tab[1]}`);
    document.title=`${year} 財務追蹤`;
    const brandYear=document.getElementById('brandYear');if(brandYear)brandYear.textContent=`目前年度：${year}`;
    searchInput.value=ui.search[ui.tab]||'';
    searchInput.disabled=ui.tab==='settings';
    searchInput.placeholder='搜尋目前分頁';
    const renderers={cash:renderCash,credit:renderCredit,cardFees:renderCardFees,home:renderHome,installments:renderInstallments,mortgage:renderMortgage,tax:renderTax,investment:renderInvestment,lunch:renderLunch,settings:renderSettings};
    const content=renderers[ui.tab]();
    main.innerHTML=ui.tab==='settings'?content:`<section class="page-search-panel no-print"><div id="pageSearchSlot"></div></section><div id="pageContent">${content}</div>`;
    placeGlobalControls();
    location.hash=ui.tab;
    saveUiPrefs();
  }

  function renderSearchResults(){
    const contentHost=document.getElementById('pageContent');
    if(!contentHost||ui.tab==='settings'){render();return;}
    const scrollY=window.scrollY;
    const renderers={cash:renderCash,credit:renderCredit,cardFees:renderCardFees,home:renderHome,installments:renderInstallments,mortgage:renderMortgage,tax:renderTax,investment:renderInvestment,lunch:renderLunch,settings:renderSettings};
    const renderer=renderers[ui.tab];
    if(!renderer){render();return;}
    contentHost.innerHTML=renderer();
    saveUiPrefs();
    requestAnimationFrame(()=>window.scrollTo(0,scrollY));
  }

  function accountSummaryIncludesDate(date,year=currentYear()){
    const iso=normalizeDateValue(date,'');
    if(!iso||txYear(iso)!==Number(year))return false;
    const now=today(),nowYear=txYear(now),y=Number(year);
    if(y<nowYear)return true;
    if(y>nowYear)return false;
    return iso<=now;
  }
  function accountIncludedInTwdTotal(account){
    const text=`${account?.name||''} ${account?.note||''}`.toLowerCase();
    if(/(?:日幣|英鎊|美元|美金|歐元|jpy|gbp|usd|eur)/i.test(text))return false;
    if(String(account?.name||'').trim()==='現金(航)')return false;
    return account?.includeInTwdTotal!==false;
  }
  function accountStats(){
    const y=currentYear();
    return state.cash.accounts.map((a,i)=>({a,i})).filter(({a})=>historyAccountAvailableInYear(a,y)).map(({a,i})=>{
      const movement=sum(state.cash.transactions.filter(t=>t.account===a.name&&accountSummaryIncludesDate(t.date,y)),t=>t.amount);
      const opening=n(a.initialByYear?.[String(y)]);
      return {a,i,opening,movement,balance:opening-movement};
    });
  }
  function currentCashFilteredRows(){
    const y=currentYear(),q=ui.search.cash||'',vf=ui.viewFilters.cash||{};
    const includeUndated=!!ui.includeUndated.cash;
    const rows=filteredDataRows(state.cash.transactions,q,'cash',x=>x.date,includeUndated)
      .filter(({item})=>yearMatch(item.date,y)||(includeUndated&&!String(item.date||'').trim()))
      .filter(({item})=>!vf.category||String(item.category||'')===vf.category)
      .filter(({item})=>!vf.description||String(item.description||'')===vf.description)
      .filter(({item})=>!vf.account||String(item.account||'')===vf.account)
      .filter(({item})=>vf.rowColor==='__none__'?!validRowColor(item.rowColor):(!vf.rowColor||validRowColor(item.rowColor)===vf.rowColor));
    if(ui.revealCashId&&!rows.some(({item})=>item.id===ui.revealCashId)){
      const index=state.cash.transactions.findIndex(item=>item.id===ui.revealCashId);
      if(index>=0)rows.push({item:state.cash.transactions[index],index});
    }
    return rows.sort((a,b)=>compareDateAscValues(a.item.date,b.item.date)||a.index-b.index);
  }
  function updateCashSelectionControls(){
    const count=ui.cashSelection.size;
    const countEl=main.querySelector('[data-cash-selected-count]');
    if(countEl)countEl.textContent=`已選 ${count} 筆`;
    const filteredIds=currentCashFilteredRows().map(({item})=>item.id);
    const selectedCount=filteredIds.filter(id=>ui.cashSelection.has(id)).length;
    const all=main.querySelector('[data-bulk-cash-select-all]');
    if(all){all.checked=filteredIds.length>0&&selectedCount===filteredIds.length;all.indeterminate=selectedCount>0&&selectedCount<filteredIds.length;}
    main.querySelectorAll('[data-cash-select]').forEach(box=>box.checked=ui.cashSelection.has(box.dataset.cashSelect));
  }
  function renderCash(){
    const y=currentYear(); const stats=accountStats();
    const cashDefaultDate=defaultDateForYear();
    const cashDefaultReportMode=cashDefaultDate>today()?'neutral':'auto';
    const includeUndated=!!ui.includeUndated.cash;
    const yearTx=state.cash.transactions.filter(t=>yearMatch(t.date,y)||(includeUndated&&!String(t.date||'').trim()));
    const totalTwd=sum(stats.filter(x=>accountIncludedInTwdTotal(x.a)),x=>x.balance);
    const calendarYear=txYear(today());
    const accountMovementLabel=y===calendarYear?'截至今日交易總和':(y<calendarYear?'全年交易總和':'交易總和');
    const accountBalanceLabel=y===calendarYear?'目前餘額':(y<calendarYear?'年末餘額':'期初餘額');
    const accountTotalLabel=y===calendarYear?`${y} 年截至今日台幣帳戶餘額總計`:(y<calendarYear?`${y} 年末台幣帳戶餘額總計`:`${y} 年台幣帳戶期初餘額總計`);
    const incomes=yearTx.filter(t=>cashFlow(t)==='income');
    const expenses=yearTx.filter(t=>cashFlow(t)==='expense');
    const income=sum(incomes,t=>Math.abs(n(t.amount))), expense=sum(expenses,t=>n(t.amount));
    const q=ui.search.cash||'';
    const vf=ui.viewFilters.cash||{};
    const categoryOpts=uniqueStrings(yearTx.map(t=>t.category));
    const descriptionOpts=uniqueStrings(yearTx.map(t=>t.description));
    const accountOpts=state.cash.accounts.filter(a=>historyAccountAvailableInYear(a,y)).map(a=>a.name);
    const validCashIds=new Set(state.cash.transactions.map(t=>t.id));
    [...ui.cashSelection].forEach(id=>{if(!validCashIds.has(id))ui.cashSelection.delete(id);});
    const cashRows=currentCashFilteredRows();
    const filteredCashIds=cashRows.map(({item})=>item.id);
    const selectedFilteredCount=filteredCashIds.filter(id=>ui.cashSelection.has(id)).length;
    const allFilteredSelected=filteredCashIds.length>0&&selectedFilteredCount===filteredCashIds.length;
    const p=paged(cashRows,'cash',70);
    const cashFilters=viewFilterBar('cash',[
      viewFilterSelect('cash','category','科目',vf.category||'',[['','全部科目'],...categoryOpts.map(x=>[x,x])]),
      viewFilterSelect('cash','description','描述',vf.description||'',[['','全部描述'],...descriptionOpts.map(x=>[x,x])]),
      viewFilterSelect('cash','account','帳戶',vf.account||'',[['','全部帳戶'],...accountOpts.map(x=>[x,x])]),
      viewFilterSelect('cash','rowColor','顏色',vf.rowColor||'',[['','全部顏色'],['__none__','無'],...ROW_COLORS.filter(c=>c.id).map(c=>[c.id,c.name])])
    ].join(''));
    return `<div class="page-stack">
      <section class="kpis">
        <div class="kpi accent"><span>${accountTotalLabel}</span><strong>${money(totalTwd)}</strong></div>
        <div class="kpi positive"><span>${y} 年收入（負值）${includeUndated?'＋空白日期預估':''}</span><strong>${money(income)}</strong></div>
        <div class="kpi negative"><span>${y} 年支出（正值）${includeUndated?'＋空白日期預估':''}</span><strong>${money(expense)}</strong></div>
        <div class="kpi"><span>${y} 年交易筆數</span><strong>${plain(yearTx.length)}</strong></div>
      </section>
      <section class="card">
        <div class="section-head"><div><h2>${y} 年帳戶摘要</h2><p>餘額＝期初現金－已發生交易金額；未來預先建立與空白日期的項目不會提前影響帳戶餘額。</p></div><button data-action="add-account">新增帳戶</button></div>
        <div class="table-wrap account-summary-wrap"><table class="data-table account-summary-table fit-table"><thead><tr><th><span class="desktop-label">帳戶</span><span class="mobile-label">帳戶</span></th><th class="numeric"><span class="desktop-label">${y} 年期初現金</span><span class="mobile-label">期初</span></th><th class="numeric"><span class="desktop-label">${accountMovementLabel}</span><span class="mobile-label">交易</span></th><th class="numeric"><span class="desktop-label">${accountBalanceLabel}</span><span class="mobile-label">餘額</span></th><th>備註</th><th><span class="desktop-label">操作</span><span class="mobile-label">刪</span></th></tr></thead><tbody>
          ${stats.map(({a,i,opening,movement,balance})=>`<tr><td data-label="帳戶">${input(`cash.accounts.${i}.name`,a.name)}</td><td data-label="${y} 年期初現金">${input(`cash.accounts.${i}.initialByYear.${y}`,opening,'number')}</td><td data-label="${accountMovementLabel}" class="numeric computed">${money(movement,2)}</td><td data-label="${accountBalanceLabel}" class="numeric computed">${money(balance,2)}</td><td data-label="備註">${input(`cash.accounts.${i}.note`,a.note)}</td><td data-label="操作"><button class="small danger" data-action="delete" data-array="cash.accounts" data-index="${i}"><span class="desktop-label">刪除</span><span class="mobile-label">刪</span></button></td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="card no-print">
        <div class="section-head"><div><h2>固定現金項目</h2><p>固定項目跨年度共用；「帶入」後可清空日期，作為尚未扣款的預估支出。</p></div><button data-action="add-cash-template">新增固定項目</button></div>
        <div class="table-wrap cash-template-wrap"><table class="data-table cash-template-table fit-table"><thead><tr><th>科目</th><th>描述</th><th class="numeric">金額</th><th>帳戶</th><th><span class="month-report-heading">月報<br>處理</span></th><th>操作</th></tr></thead><tbody>
          ${state.cash.templates.length?state.cash.templates.map((t,i)=>`<tr><td>${input(`cash.templates.${i}.category`,t.category)}</td><td>${input(`cash.templates.${i}.description`,t.description)}</td><td>${input(`cash.templates.${i}.amount`,t.amount,'number')}</td><td>${select(`cash.templates.${i}.account`,t.account,accountOpts)}</td><td>${reportModeToggle(`cash.templates.${i}.reportMode`,t.reportMode)}</td><td class="cash-template-actions"><div><button class="small primary template-use-button" data-action="use-cash-template" data-index="${i}"><span class="template-use-label">帶入</span></button><button class="small" data-action="copy-cash-template" data-index="${i}">複製</button><button class="small danger" data-action="delete" data-array="cash.templates" data-index="${i}">刪除</button></div></td></tr>`).join(''):empty(6,'尚未建立固定現金項目')}
        </tbody></table></div>
      </section>
      <section class="card no-print">
        <div class="section-head"><div><h2>新增 ${y} 年現金交易</h2><p>金額正負號決定收支；轉存、卡費等不應重複列入月報的項目選「不列入月報」。</p></div></div>
        <form class="form-grid cash-entry-form compact-entry-form" data-form="cash">
          <div class="field cash-date-field cash-entry-date"><label>日期（可留白）</label>${formDateInput('date',cashDefaultDate,`min="${y}-01-01" max="${y}-12-31"`)}</div>
          <div class="field cash-entry-category"><label>科目</label><input name="category" required></div>
          <div class="field cash-entry-description"><label>描述</label><input name="description"></div>
          <div class="field cash-entry-amount"><label>金額（正支出／負收入）</label><input name="amount" type="number" step="any" required></div>
          <div class="field cash-entry-account"><label>帳戶</label><select name="account" required><option value="" selected>請選擇帳戶</option>${accountOpts.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>
          <div class="field cash-entry-report"><label>月報處理</label><select name="reportMode"><option value="auto" ${cashDefaultReportMode==='auto'?'selected':''}>＋／－</option><option value="neutral" ${cashDefaultReportMode==='neutral'?'selected':''}>× 不列入月報</option></select></div>
          <div class="field cash-entry-color"><label>標記顏色</label>${rowColorForm('rowColor')}</div>
          <button class="primary" type="submit">新增交易</button>
        </form>
      </section>
      <section class="card" id="cashTransactionList">
        <div class="section-head"><div><h2>${y} 年現金花費</h2><p>正值＝支出，負值＝收入；開啟「空白日期納入總計」可把尚未扣款或日期未定的預算一起計算。</p></div><div class="filter-stack">${dateFilterBar('cash','cash')}${cashFilters}</div></div>
        <div class="cash-bulk-toolbar no-print">
          <strong data-cash-selected-count>已選 ${ui.cashSelection.size} 筆</strong>
          <label>月報處理<select data-bulk-cash-report><option value="__keep__">保持不變</option><option value="auto">＋／－</option><option value="neutral">× 不列入月報</option></select></label>
          <label>顏色<select class="row-color-select" data-bulk-cash-color><option value="__keep__">保持不變</option><option value="__none__">無</option>${ROW_COLORS.filter(c=>c.id).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
          <button class="small primary" type="button" data-action="apply-cash-bulk">套用到已選資料</button>
          <button class="small" type="button" data-action="clear-cash-selection">取消選取</button>
        </div>
        <div class="table-wrap cash-transactions-wrap"><table class="data-table cash-transactions-table fit-table"><thead><tr><th class="cash-select-col" title="全選目前篩選結果"><input class="cash-bulk-check" type="checkbox" data-bulk-cash-select-all ${allFilteredSelected?'checked':''} aria-label="全選目前篩選結果"></th><th class="date-col">日期</th><th>科目</th><th class="description-col">描述</th><th class="numeric">金額</th><th>帳戶</th><th><span class="month-report-heading">月報<br>處理</span></th><th class="row-color-cell">顏色</th><th><span class="mobile-label">刪</span></th></tr></thead><tbody>
          ${p.rows.length?p.rows.map(({item:t,index:i})=>{const rowColor=validRowColor(t.rowColor);return `<tr data-cash-id="${esc(t.id||'')}" data-row-color="${esc(rowColor)}"><td class="cash-select-col"><input class="cash-bulk-check" type="checkbox" data-cash-select="${esc(t.id)}" ${ui.cashSelection.has(t.id)?'checked':''} aria-label="選取這筆現金交易"></td><td class="date-col">${input(`cash.transactions.${i}.date`,t.date,'date')}</td><td>${input(`cash.transactions.${i}.category`,t.category)}</td><td class="description-col">${input(`cash.transactions.${i}.description`,t.description)}</td><td>${input(`cash.transactions.${i}.amount`,t.amount,'number')}</td><td>${select(`cash.transactions.${i}.account`,t.account,accountOpts)}</td><td>${reportModeToggle(`cash.transactions.${i}.monthlyFlow`,t.monthlyFlow)}</td><td class="row-color-cell">${rowColorSelect(`cash.transactions.${i}.rowColor`,rowColor)}</td><td><button class="small danger" data-action="delete" data-array="cash.transactions" data-index="${i}"><span class="desktop-label">刪除</span><span class="mobile-label">刪</span></button></td></tr>`}).join(''):empty(9,`${y} 年目前沒有符合條件的交易`)}
        </tbody></table></div>${pager('cash',p)}
      </section>
    </div>`;
  }

  function creditIncludedInTotal(t){return normalizeReportMode(t.monthlyFlow)!=='neutral';}
  function creditYearRows(card,year=currentYear(),includeUndated=!!ui.includeUndated.credit){
    return card.transactions.filter(t=>yearMatch(t.date,year)||(includeUndated&&!String(t.date||'').trim()));
  }
  function cardTotals(card,year=currentYear(),includeUndated=!!ui.includeUndated.credit){
    const tx=creditYearRows(card,year,includeUndated).filter(creditIncludedInTotal);
    const amount=sum(tx,t=>t.amount), fee=sum(tx,t=>t.fee);
    const paid=sum(tx.filter(t=>t.paid),t=>n(t.amount)+n(t.fee));
    const outstanding=sum(tx.filter(t=>!t.paid),t=>n(t.amount)+n(t.fee));
    return {amount,fee,paid,outstanding,count:tx.length};
  }
  function creditTotalModeLabel(value){return normalizeReportMode(value)==='neutral'?'不列入總計':'列入總計';}
  function creditTotalModeToggle(path,value){
    const mode=normalizeReportMode(value),label=creditTotalModeLabel(mode);
    return `<button type="button" class="report-mode-toggle credit-total-toggle ${mode}" data-action="toggle-credit-total-mode" data-path="${esc(path)}" data-mode="${mode}" title="${esc(label)}" aria-label="${esc(label)}">${reportModeIcon(mode)}</button>`;
  }
  function renderCredit(){
    const y=currentYear();
    const visibleCards=state.creditCards.map((card,index)=>({card,index})).filter(({card})=>creditCardAvailableInYear(card,y));
    if(!visibleCards.some(x=>x.index===ui.activeCard))ui.activeCard=visibleCards[0]?.index??0;
    const card=state.creditCards[ui.activeCard];
    if(!card) return `<div class="page-stack"><section class="card empty">目前沒有信用卡資料。<button type="button" data-action="add-card">新增卡別</button></section>${ui.showAddCard?creditCardCreateForm():''}</div>`;
    const includeUndated=!!ui.includeUndated.credit;
    const totals=cardTotals(card,y,includeUndated); let run=0; const balances={};
    card.transactions.forEach((t,i)=>{if((yearMatch(t.date,y)||(includeUndated&&!String(t.date||'').trim()))&&creditIncludedInTotal(t)){if(!t.paid)run+=n(t.amount)+n(t.fee);balances[i]=run;}});
    const q=ui.search.credit||''; const filterKey=`credit-${ui.activeCard}`;
    const filtered=filteredDataRows(card.transactions,q,filterKey,x=>x.date,includeUndated)
      .filter(({item})=>yearMatch(item.date,y)||(includeUndated&&!String(item.date||'').trim()))
      .filter(({item})=>!ui.creditUnpaidOnly||!item.paid);
    const p=paged(filtered,filterKey,70);
    const allFilteredPaid=filtered.length>0&&filtered.every(({item})=>item.paid);
    return `<div class="page-stack">
      <section class="summary-grid credit-summary-grid">
        ${visibleCards.map(({card:c,index:i})=>{const x=cardTotals(c,y,includeUndated);return `<button class="summary-tile ${i===ui.activeCard?'active-card':''}" data-action="set-card" data-index="${i}"><h4>${esc(c.bank)}</h4><div class="big">${money(x.outstanding)}</div><small>${y} 未繳${includeUndated?'＋預估':''}｜${esc(c.title)}</small></button>`}).join('')}
      </section>
      <section class="card">
        <div class="section-head"><div><h2>${y}｜${esc(card.title)}</h2><p>已繳勾選後不再計入未繳餘額；統計按鈕可決定該筆是否加入總計。</p></div><div class="chips"><button type="button" data-action="add-card">新增卡別</button><button type="button" class="danger" data-action="delete-card" data-index="${ui.activeCard}">刪除此卡別</button></div></div>
        <div class="form-grid credit-card-settings-form">
          <div class="field"><label>顯示名稱</label>${input(`creditCards.${ui.activeCard}.title`,card.title)}</div>
          <div class="field"><label>銀行</label>${input(`creditCards.${ui.activeCard}.bank`,card.bank)}</div>
          <div class="field"><label>額度</label>${input(`creditCards.${ui.activeCard}.limit`,card.limit,'number')}</div>
          <div class="field"><label>${y} 消費金額</label><input readonly value="${money(totals.amount)}"></div>
          <div class="field"><label>${y} 手續費</label><input readonly value="${money(totals.fee)}"></div>
          <div class="field"><label>${y} 未繳餘額</label><input readonly value="${money(totals.outstanding)}"></div>
        </div>
        ${ui.deleteCardIndex===ui.activeCard?`<div class="delete-confirm"><div><strong>確定刪除「${esc(card.title)}」？</strong><span>這會一併刪除此卡別的交易與固定支出模板。</span></div><div class="chips"><button type="button" data-action="cancel-delete-card">取消</button><button type="button" class="danger" data-action="confirm-delete-card" data-index="${ui.activeCard}">確定刪除</button></div></div>`:''}
      </section>
      ${ui.showAddCard?creditCardCreateForm():''}
      <section class="card no-print">
        <div class="section-head"><div><h2>固定信用卡支出</h2><p>固定支出跨年度共用；按「帶入」後可清空日期，作為尚未扣款的預估支出。</p></div><button data-action="add-credit-template">新增固定支出</button></div>
        <div class="table-wrap credit-template-wrap"><table class="data-table credit-template-table fit-table"><thead><tr><th class="description-col">描述</th><th class="numeric">金額</th><th class="store-col">商店名稱</th><th>卡片</th><th class="numeric">手續費</th><th>操作</th></tr></thead><tbody>
          ${card.templates.length?card.templates.map((t,i)=>`<tr><td class="description-col">${input(`creditCards.${ui.activeCard}.templates.${i}.description`,t.description)}</td><td>${input(`creditCards.${ui.activeCard}.templates.${i}.amount`,t.amount,'number')}</td><td class="store-col">${input(`creditCards.${ui.activeCard}.templates.${i}.store`,t.store)}</td><td>${input(`creditCards.${ui.activeCard}.templates.${i}.card`,t.card)}</td><td>${input(`creditCards.${ui.activeCard}.templates.${i}.fee`,t.fee,'number')}</td><td class="nowrap credit-template-actions"><div class="credit-template-action-grid"><button class="small primary template-use-button" data-action="use-credit-template" data-index="${i}"><span class="template-use-label">帶入</span><span class="template-use-leaf" aria-hidden="true"></span></button><button class="small" data-action="copy-credit-template" data-index="${i}">複製</button><button class="small danger" data-action="delete" data-array="creditCards.${ui.activeCard}.templates" data-index="${i}">刪除</button></div></td></tr>`).join(''):empty(6,'尚未建立固定信用卡支出')}
        </tbody></table></div>
      </section>
      <section class="card no-print">
        <h2>新增 ${y} 年信用卡交易</h2>
        <form class="form-grid credit-entry-form compact-entry-form" data-form="credit">
          <div class="field credit-entry-date"><label>日期（可留白）</label>${formDateInput('date',defaultDateForYear(),`min="${y}-01-01" max="${y}-12-31"`)}</div>
          <div class="field credit-entry-description"><label>描述</label><input name="description" required></div>
          <div class="field credit-entry-amount"><label>金額</label><input name="amount" type="number" step="any" required></div>
          <div class="field credit-entry-store"><label>商店名稱</label><input name="store"></div>
          <div class="field credit-entry-card"><label>卡片</label><input name="card"></div>
          <div class="field credit-entry-fee"><label>交易手續費</label><input name="fee" type="number" step="any" value="0"></div>
          <button class="primary" type="submit">新增交易</button>
        </form>
      </section>
      <section class="card">
        <div class="section-head"><div><h2>${y} 年信用卡交易紀錄</h2><p>開啟「空白日期納入總計」可把尚未扣款、日期未定的固定支出列入預算。</p></div>${dateFilterBar(filterKey,'credit',`<button type="button" class="small credit-unpaid-filter ${ui.creditUnpaidOnly?'active':''}" data-action="toggle-credit-unpaid" aria-pressed="${ui.creditUnpaidOnly?'true':'false'}">${ui.creditUnpaidOnly?'✓ 顯示未繳':'顯示未繳'}</button>`)}</div>
        <div class="table-wrap credit-transactions-wrap"><table class="data-table credit-transactions-table fit-table"><thead><tr><th class="date-col">日期</th><th class="description-col">描述</th><th class="numeric">金額</th><th class="store-col">商店名稱</th><th>卡片</th><th class="numeric fee-heading-col">手續費</th><th>統計</th><th class="paid-col" title="全選目前篩選結果"><input class="paid-check" type="checkbox" data-bulk-paid="${ui.activeCard}" ${allFilteredPaid?'checked':''} aria-label="全選已繳"></th><th class="numeric unpaid-heading-col">未繳累計</th><th><span class="mobile-label">刪</span></th></tr></thead><tbody>
          ${p.rows.length?p.rows.map(({item:t,index:i})=>`<tr class="${t.paid?'paid-row':''}"><td class="date-col">${input(`creditCards.${ui.activeCard}.transactions.${i}.date`,t.date,'date')}</td><td class="description-col">${input(`creditCards.${ui.activeCard}.transactions.${i}.description`,t.description)}</td><td>${input(`creditCards.${ui.activeCard}.transactions.${i}.amount`,t.amount,'number')}</td><td class="store-col">${input(`creditCards.${ui.activeCard}.transactions.${i}.store`,t.store)}</td><td>${input(`creditCards.${ui.activeCard}.transactions.${i}.card`,t.card)}</td><td>${input(`creditCards.${ui.activeCard}.transactions.${i}.fee`,t.fee,'number')}</td><td class="credit-total-col">${creditTotalModeToggle(`creditCards.${ui.activeCard}.transactions.${i}.monthlyFlow`,t.monthlyFlow)}</td><td class="paid-col">${checkbox(`creditCards.${ui.activeCard}.transactions.${i}.paid`,t.paid,'')}</td><td class="numeric computed">${balances[i]===undefined?'—':money(balances[i])}</td><td><button class="small danger" data-action="delete" data-array="creditCards.${ui.activeCard}.transactions" data-index="${i}">刪除</button></td></tr>`).join(''):empty(10,`${y} 年目前沒有信用卡交易`)}
        </tbody><tfoot><tr><td>${y} 年交易${includeUndated?'＋預估':''}</td><td></td><td class="numeric">${money(totals.amount)}</td><td></td><td></td><td class="numeric">${money(totals.fee)}</td><td></td><td></td><td class="numeric">未繳 ${money(totals.outstanding)}</td><td></td></tr></tfoot></table></div>${pager(filterKey,p)}
      </section>
    </div>`;
  }

  function transactionDateParts(value){
    const raw=String(value||'').trim();
    const match=raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if(match){
      const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
      if(year>=1900&&month>=1&&month<=12&&day>=1&&day<=31)return {year,month,day};
    }
    const parsed=new Date(raw);
    if(!raw||Number.isNaN(parsed.getTime()))return null;
    return {year:parsed.getFullYear(),month:parsed.getMonth()+1,day:parsed.getDate()};
  }
  function cashMonthlyTotals(year=currentYear()){
    const totals=Array.from({length:12},(_,index)=>({month:index+1,expense:0,income:0}));
    (state.cash?.transactions||[]).forEach(transaction=>{
      const parts=transactionDateParts(transaction?.date);
      if(!parts||parts.year!==Number(year))return;
      const flow=cashFlow(transaction);
      if(flow==='expense')totals[parts.month-1].expense+=Math.max(0,n(transaction.amount));
      if(flow==='income')totals[parts.month-1].income+=Math.abs(Math.min(0,n(transaction.amount)));
    });
    return totals;
  }
  function cashMonth(month,year=currentYear()){
    return cashMonthlyTotals(year)[Number(month)-1]||{month:Number(month)||0,expense:0,income:0};
  }
  function renderCardFees(){
    const y=currentYear(), months=state.meta.months, book=currentCardFeeBook();
    const monthTotals=months.map((_,m)=>sum(book.banks,r=>r.months[m]));
    const cashMonths=cashMonthlyTotals(y);
    return `<div class="page-stack">
      <section class="card">
        <div class="section-head"><div><h2>${y} 年各銀行卡費</h2><p>目前年度由「設定」切換；每月總計由各銀行列自動加總。</p></div><button data-action="add-fee-bank">新增銀行</button></div>
        <div class="table-wrap"><table class="data-table matrix-table"><thead><tr><th>銀行</th>${months.map(m=>`<th class="numeric">${m}</th>`).join('')}<th></th></tr></thead><tbody>
          ${book.banks.map((r,i)=>`<tr><td>${input(`cardFees.yearBooks.${y}.banks.${i}.bank`,r.bank)}</td>${r.months.map((v,m)=>`<td>${input(`cardFees.yearBooks.${y}.banks.${i}.months.${m}`,v,'number')}</td>`).join('')}<td><button class="small danger" data-action="delete" data-array="cardFees.yearBooks.${y}.banks" data-index="${i}">刪除</button></td></tr>`).join('')}
          <tr class="total-row"><td>總計</td>${monthTotals.map(v=>`<td class="numeric">${money(v)}</td>`).join('')}<td></td></tr>
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="section-head"><div><h2>歷年卡費</h2><p>保留原 Excel 的歷年月份比較資料；詳細年度內容請從「設定」切換年份。</p></div><button data-action="add-fee-history">新增年度</button></div>
        <div class="table-wrap"><table class="data-table matrix-table"><thead><tr><th>年度</th>${months.map(m=>`<th class="numeric">${m}</th>`).join('')}<th></th></tr></thead><tbody>
          ${state.cardFees.history.map((r,i)=>`<tr><td>${input(`cardFees.history.${i}.year`,r.year)}</td>${r.months.map((v,m)=>`<td>${input(`cardFees.history.${i}.months.${m}`,v,'number')}</td>`).join('')}<td><button class="small danger" data-action="delete" data-array="cardFees.history" data-index="${i}">刪除</button></td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="section-head"><div><h2>${y} 年每月開銷</h2><p>現金／轉帳與收入依 ${y} 年「現金花費」日期自動歸月。</p></div></div>
        <div class="formula-note">現金／轉帳＝該月列入月報的正值交易合計；收入＝該月列入月報的負值交易絕對值合計；每月餘額＝收入－現金／轉帳－刷卡。</div>
        <div class="table-wrap monthly-expense-wrap"><table class="data-table matrix-table monthly-expense-table"><thead><tr><th>月份</th><th class="numeric">現金／轉帳</th><th class="numeric">刷卡</th><th class="numeric">收入</th><th class="numeric">每月餘額</th><th class="numeric">總薪水</th><th class="numeric">喜樂薪水</th></tr></thead><tbody>
          ${book.monthlyInputs.map((r,i)=>{const c=cashMonths[i]||{expense:0,income:0};const cashNet=c.expense;const bal=c.income-cashNet-monthTotals[i];return `<tr><td>${months[i]}</td><td class="numeric computed">${money(cashNet)}</td><td class="numeric computed">${money(monthTotals[i])}</td><td class="numeric computed">${money(c.income)}</td><td class="numeric computed ${bal>=0?'income':'expense'}">${money(bal)}</td><td>${input(`cardFees.yearBooks.${y}.monthlyInputs.${i}.salary`,r.salary,'number')}</td><td>${input(`cardFees.yearBooks.${y}.monthlyInputs.${i}.musicSalary`,r.musicSalary,'number')}</td></tr>`}).join('')}
        </tbody></table></div>
      </section>
    </div>`;
  }

  function renderHome(){
    const y=currentYear(),months=state.meta.months,book=currentHomeBook(); const totals=months.map((_,m)=>sum(book.items,r=>r.months[m]));
    return `<div class="page-stack"><section class="card">
      <div class="section-head"><div><h2>${y} 年家的支出</h2><p>目前年度由「設定」切換；各月份總計由所有項目自動加總。</p></div><button data-action="add-home-item">新增項目</button></div>
      <div class="table-wrap"><table class="data-table matrix-table"><thead><tr><th>項目</th>${months.map(m=>`<th class="numeric">${m}</th>`).join('')}<th></th></tr></thead><tbody>
        ${book.items.map((r,i)=>`<tr><td>${input(`homeExpenses.yearBooks.${y}.items.${i}.item`,r.item)}</td>${r.months.map((v,m)=>`<td>${input(`homeExpenses.yearBooks.${y}.items.${i}.months.${m}`,v,'number')}</td>`).join('')}<td><button class="small danger" data-action="delete" data-array="homeExpenses.yearBooks.${y}.items" data-index="${i}">刪除</button></td></tr>`).join('')}
        <tr class="total-row"><td>總計</td>${totals.map(v=>`<td class="numeric">${money(v)}</td>`).join('')}<td></td></tr>
      </tbody></table></div></section>
      <section class="card"><div class="section-head"><h2>歷年比較</h2><button data-action="add-home-history">新增年度</button></div><div class="table-wrap"><table class="data-table matrix-table"><thead><tr><th>年度</th>${months.map(m=>`<th class="numeric">${m}</th>`).join('')}<th></th></tr></thead><tbody>${state.homeExpenses.history.map((r,i)=>`<tr><td>${input(`homeExpenses.history.${i}.year`,r.year)}</td>${r.months.map((v,m)=>`<td>${input(`homeExpenses.history.${i}.months.${m}`,v,'number')}</td>`).join('')}<td><button class="small danger" data-action="delete" data-array="homeExpenses.history" data-index="${i}">刪除</button></td></tr>`).join('')}</tbody></table></div></section>
    </div>`;
  }

  function renderInstallments(){
    const y=currentYear();
    const activeRows=state.installments.map((item,index)=>({item,index})).filter(({item})=>normalizeYear(item.year)===y);
    const historyRows=filteredDataRows(state.installmentHistory,ui.search.installments||'','installment-history',x=>x.completedAt).filter(({item})=>yearMatch(item.completedAt,y));
    return `<div class="page-stack">
      <section class="card"><div class="section-head"><div><h2>${y} 年進行中的分期</h2><p>完成後會移入 ${y} 年歷史紀錄。</p></div><button data-action="add-installment">新增分期</button></div>
        <div class="installment-grid">${activeRows.length?activeRows.map(({item:it,index:i},pos)=>`<article class="installment-card"><div class="section-head"><strong>分期 ${pos+1}</strong><div class="chips"><button type="button" class="small primary" data-action="complete-installment" data-index="${i}">✓ 完成</button><button class="small danger" data-action="delete" data-array="installments" data-index="${i}">刪除</button></div></div><div class="header-fields"><div class="field"><label>項目</label>${input(`installments.${i}.title`,it.title)}</div><div class="field"><label>總額</label>${input(`installments.${i}.total`,it.total,'number')}</div></div><div class="field"><label>扣款帳戶</label>${input(`installments.${i}.account`,it.account)}</div>${it.plans.map((p,j)=>`<div class="plan-row">${input(`installments.${i}.plans.${j}.label`,p.label)}${input(`installments.${i}.plans.${j}.amount`,p.amount,'number')}${input(`installments.${i}.plans.${j}.schedule`,p.schedule)}<button class="small danger" data-action="delete" data-array="installments.${i}.plans" data-index="${j}">×</button></div>`).join('')}<button class="small" data-action="add-plan" data-index="${i}">＋新增期別</button><div class="field" style="margin-top:8px"><label>備註</label>${textarea(`installments.${i}.note`,it.note||'')}</div></article>`).join(''):`<div class="empty">${y} 年目前沒有進行中的分期。</div>`}</div>
      </section>
      <section class="card"><div class="section-head"><div><h2>${y} 年分期歷史紀錄</h2><p>歷史項目可恢復到進行中。</p></div>${dateFilterBar('installment-history')}</div>
        <div class="table-wrap"><table class="data-table installment-history-table"><thead><tr><th class="date-col">完成日</th><th>項目</th><th class="numeric">總額</th><th>扣款帳戶</th><th>期別明細</th><th>備註</th><th></th></tr></thead><tbody>
          ${historyRows.length?historyRows.map(({item:it,index:i})=>`<tr><td class="date-col">${input(`installmentHistory.${i}.completedAt`,it.completedAt,'date')}</td><td>${esc(it.title)}</td><td class="numeric">${money(it.total)}</td><td>${esc(it.account)}</td><td>${esc((it.plans||[]).map(p=>`${p.label} ${plain(p.amount)} ${p.schedule}`.trim()).join('；'))}</td><td>${esc(it.note||'')}</td><td class="nowrap"><button class="small" data-action="restore-installment" data-index="${i}">恢復</button> <button class="small danger" data-action="delete" data-array="installmentHistory" data-index="${i}">刪除</button></td></tr>`).join(''):empty(7,`${y} 年尚無完成的分期紀錄`)}
        </tbody></table></div>
      </section>
    </div>`;
  }

  function mortgageStats(){
    return state.mortgage.accounts.map((a,i)=>{const paid=sum(state.mortgage.payments.filter(p=>p.account===a.name),p=>p.amount);return {a,i,paid,balance:n(a.principal)-paid};});
  }
  function renderMortgage(){
    const stats=mortgageStats(); const q=ui.search.mortgage||''; const vf=ui.viewFilters.mortgage||{};
    const accounts=state.mortgage.accounts.map(a=>a.name);
    const loanTypes=uniqueStrings(state.mortgage.accounts.map(a=>a.loanType).concat(state.mortgage.payments.map(x=>x.loanType)));
    const paymentYears=uniqueYears(state.mortgage.payments.map(x=>txYear(x.date)));
    const rows=filteredDataRows(state.mortgage.payments,q,'mortgage')
      .filter(({item})=>!vf.year||txYear(item.date)===Number(vf.year))
      .filter(({item})=>!vf.account||String(item.account||'')===vf.account)
      .filter(({item})=>!vf.loanType||String(item.loanType||'')===vf.loanType)
      .sort((a,b)=>compareDateAscValues(a.item.date,b.item.date)||a.index-b.index);
    const p=paged(rows,'mortgage',70);
    const filteredPayments=rows.map(x=>x.item);
    const filterBar=viewFilterBar('mortgage',[
      viewFilterSelect('mortgage','year','年份',vf.year||'',[['','全部年度'],...paymentYears.map(y=>[String(y),`${y} 年`])]),
      viewFilterSelect('mortgage','loanType','貸款類型',vf.loanType||'',[['','全部類型'],...loanTypes.map(x=>[x,x])]),
      viewFilterSelect('mortgage','account','帳戶',vf.account||'',[['','全部帳戶'],...accounts.map(x=>[x,x])])
    ].join(''));
    const listTitle=vf.year?`${vf.year} 年還款記錄`:'全部年度還款記錄';
    return `<div class="page-stack"><section class="kpis"><div class="kpi accent"><span>貸款總額</span><strong>${money(sum(stats,x=>x.a.principal))}</strong></div><div class="kpi"><span>篩選還款總額</span><strong>${money(sum(filteredPayments,x=>x.amount))}</strong></div><div class="kpi negative"><span>目前總餘額</span><strong>${money(sum(stats,x=>x.balance))}</strong></div><div class="kpi"><span>篩選還款筆數</span><strong>${plain(filteredPayments.length)}</strong></div></section>
      <section class="card"><div class="section-head"><div><h2>貸款摘要</h2><p>餘額使用全部年度還款計算；下方還款明細預設顯示全部年度。</p></div><button data-action="add-mortgage-account">新增帳戶</button></div><div class="table-wrap mortgage-summary-wrap"><table class="data-table mortgage-summary-table fit-table"><thead><tr><th>帳戶</th><th>貸款類型</th><th class="numeric">貸款總額</th><th class="numeric">歷年總還款</th><th class="numeric">目前餘額</th><th>備註</th><th></th></tr></thead><tbody>${stats.map(({a,i,paid,balance})=>`<tr><td>${input(`mortgage.accounts.${i}.name`,a.name)}</td><td>${input(`mortgage.accounts.${i}.loanType`,a.loanType)}</td><td>${input(`mortgage.accounts.${i}.principal`,a.principal,'number')}</td><td class="numeric computed">${money(paid)}</td><td class="numeric computed">${money(balance)}</td><td>${input(`mortgage.accounts.${i}.note`,a.note)}</td><td><button class="small danger" data-action="delete" data-array="mortgage.accounts" data-index="${i}">刪除</button></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card no-print"><h2>新增貸款還款</h2><form class="form-grid mortgage-entry-form compact-entry-form" data-form="mortgage"><div class="field mortgage-entry-date"><label>日期</label>${formDateInput('date',defaultDateForYear(),'required')}</div><div class="field mortgage-entry-type"><label>貸款類型</label><input name="loanType" list="loanTypeOptions" placeholder="例如：房貸、信貸"></div><div class="field mortgage-entry-account"><label>帳戶</label><select name="account">${accounts.map(a=>`<option>${esc(a)}</option>`).join('')}</select></div><div class="field mortgage-entry-description"><label>描述</label><input name="description"></div><div class="field mortgage-entry-amount"><label>金額</label><input name="amount" type="number" step="any" required></div><datalist id="loanTypeOptions">${loanTypes.map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist><button class="primary">新增還款</button></form></section>
      <section class="card" id="mortgagePaymentList"><div class="section-head"><div><h2>${listTitle}</h2><p>由上方過去日期排列至下方未來日期，可依年份、貸款類型與帳戶篩選。</p></div><div class="filter-stack">${dateFilterBar('mortgage')}${filterBar}</div></div><div class="table-wrap mortgage-payments-wrap"><table class="data-table mortgage-payments-table fit-table"><thead><tr><th class="date-col">日期</th><th>貸款類型</th><th class="description-col">描述</th><th class="numeric">金額</th><th>帳戶</th><th><span class="desktop-label">操作</span><span class="mobile-label">刪</span></th></tr></thead><tbody>${p.rows.length?p.rows.map(({item:x,index:i})=>`<tr><td class="date-col">${input(`mortgage.payments.${i}.date`,x.date,'date')}</td><td>${input(`mortgage.payments.${i}.loanType`,x.loanType)}</td><td class="description-col">${input(`mortgage.payments.${i}.description`,x.description)}</td><td>${input(`mortgage.payments.${i}.amount`,x.amount,'number')}</td><td>${select(`mortgage.payments.${i}.account`,x.account,accounts)}</td><td><button class="small danger" data-action="delete" data-array="mortgage.payments" data-index="${i}"><span class="desktop-label">刪除</span><span class="mobile-label">刪</span></button></td></tr>`).join(''):empty(6,'目前沒有符合篩選條件的還款紀錄')}</tbody></table></div>${pager('mortgage',p)}</section>
    </div>`;
  }

  function renderTax(){
    const q=ui.search.tax||''; const vf=ui.viewFilters.tax||{};
    const taxes=state.taxesInvestments.taxes;
    const itemDefs=[['houseTax','房屋稅'],['insurance','火災地震險'],['incomeTax','綜所稅'],['landTax','地價稅']];
    const visibleDefs=vf.item?itemDefs.filter(([key])=>key===vf.item):itemDefs;
    const years=uniqueYears(taxes.map(x=>gregorianYear(x.year)).concat([currentYear()]));
    const taxRows=taxes.map((item,index)=>({item,index}))
      .filter(({item})=>!vf.year||gregorianYear(item.year)===Number(vf.year))
      .filter(({item})=>!q||includesText(item,q))
      .sort((a,b)=>gregorianYear(b.item.year)-gregorianYear(a.item.year)||b.index-a.index);
    const filterBar=viewFilterBar('tax',[
      viewFilterSelect('tax','year','年份',vf.year||'',[['','全部年度'],...years.map(y=>[String(y),`${y} 年`])]),
      viewFilterSelect('tax','item','項目',vf.item||'',[['','全部項目'],...itemDefs])
    ].join(''));
    const totalLabel=vf.year?`${vf.year} 年總計`:'篩選總計';
    return `<div class="page-stack"><section class="card"><div class="section-head"><div><h2>稅費（全部年度）</h2><p>預設顯示所有年度；可選擇年份與單一稅費項目，直接比較不同年度。</p></div><div class="chips"><button data-action="add-tax">新增資料（預設目前年度）</button>${filterBar}</div></div><div class="table-wrap tax-table-wrap"><table class="data-table tax-table" style="--tax-table-width:${2.35 + visibleDefs.length * 5.2 + 2.8}em"><colgroup><col class="tax-year-track">${visibleDefs.map(()=>`<col class="tax-item-track">`).join('')}<col class="tax-action-track"></colgroup><thead><tr><th class="tax-year-col">年度</th>${visibleDefs.map(([,label])=>`<th class="numeric tax-item-col">${esc(label)}</th>`).join('')}<th class="tax-action-col"></th></tr></thead><tbody>${taxRows.length?taxRows.map(({item:r,index:i})=>`<tr><td class="tax-year-col">${input(`taxesInvestments.taxes.${i}.year`,r.year)}</td>${visibleDefs.map(([key])=>`<td class="tax-item-col">${input(`taxesInvestments.taxes.${i}.${key}`,r[key],'number')}</td>`).join('')}<td class="tax-action-col"><button class="small danger" data-action="delete" data-array="taxesInvestments.taxes" data-index="${i}">刪除</button></td></tr>`).join(''):empty(visibleDefs.length+2,'目前沒有符合篩選條件的稅費資料')}<tr class="total-row"><td class="tax-year-col"><span class="tax-total-long">${totalLabel}</span><span class="tax-total-short">總計</span></td>${visibleDefs.map(([key])=>`<td class="numeric tax-item-col">${money(sum(taxRows,x=>x.item[key]))}</td>`).join('')}<td class="tax-action-col"></td></tr></tbody></table></div></section></div>`;
  }

  function renderInvestment(){
    const investFilter='investment'; const q=ui.search.investment||''; const vf=ui.viewFilters.investment||{};
    const allAssets=state.taxesInvestments.investments.map((asset,index)=>({asset,index}));
    const years=uniqueYears(allAssets.flatMap(({asset})=>(asset.transactions||[]).map(t=>txYear(t.date))));
    const assets=allAssets
      .filter(({index})=>!vf.asset||String(index)===String(vf.asset))
      .filter(({asset})=>!q||includesText(asset,q));
    const assetOptions=allAssets.map(({asset,index})=>[String(index),asset.name||`標的 ${index+1}`]);
    const filterBar=viewFilterBar('investment',[
      viewFilterSelect('investment','year','年份',vf.year||'',[['','全部年度'],...years.map(y=>[String(y),`${y} 年`])]),
      viewFilterSelect('investment','asset','投資標的',vf.asset||'',[['','全部標的'],...assetOptions])
    ].join(''));
    const dateSelection=ui.dateFilters[investFilter]||{};
    return `<div class="page-stack"><section class="card"><div class="section-head"><div><h2>投資配息（全部年度）</h2><p>預設顯示全部標的與全部年度；可依年份、投資標的及日期區間篩選。</p></div><div class="filter-stack"><div class="chips"><button data-action="add-asset">新增標的</button></div>${dateFilterBar(investFilter)}${filterBar}</div></div>${assets.length?`<div class="asset-grid">${assets.map(({asset:a,index:i})=>{
      const assetNameMatches=q&&String(a.name||'').toLowerCase().includes(q.toLowerCase());
      const rows=filteredDataRows(a.transactions,assetNameMatches?'':q,investFilter)
        .filter(({item})=>!vf.year||txYear(item.date)===Number(vf.year))
        .sort((x,y)=>compareDateAscValues(x.item.date,y.item.date)||x.index-y.index);
      const histories=yearTotals(a.transactions);
      const filteredTotal=sum(rows,x=>x.item.amount);
      const totalCaption=vf.year?`${vf.year} 年總計`:(dateSelection.from||dateSelection.to||q?'篩選總計':'全部年度總計');
      return `<article class="asset-card"><div class="section-head"><div>${input(`taxesInvestments.investments.${i}.name`,a.name)}</div><button class="small danger" data-action="delete" data-array="taxesInvestments.investments" data-index="${i}">刪除標的</button></div><div class="asset-totals"><div><span>${totalCaption}</span><strong>${money(filteredTotal)}</strong></div><details><summary>歷年總計</summary><table class="mini-history">${histories.length?histories.map(([y,v])=>`<tr><td>${y}</td><td>${money(v)}</td></tr>`).join(''):`<tr><td>尚無日期資料</td></tr>`}</table></details></div><div class="table-wrap"><table class="data-table"><thead><tr><th class="date-col">日期</th><th class="numeric">金額</th><th></th></tr></thead><tbody>${rows.length?rows.map(({item:t,index:j})=>`<tr><td class="date-col">${input(`taxesInvestments.investments.${i}.transactions.${j}.date`,t.date,'date')}</td><td>${input(`taxesInvestments.investments.${i}.transactions.${j}.amount`,t.amount,'number')}</td><td><button class="small danger" data-action="delete" data-array="taxesInvestments.investments.${i}.transactions" data-index="${j}">×</button></td></tr>`).join(''):empty(3,'目前沒有符合篩選條件的配息資料')}<tr class="total-row"><td>${totalCaption}</td><td class="numeric">${money(filteredTotal)}</td><td></td></tr></tbody></table></div><button class="small" data-action="add-invest-tx" data-index="${i}">＋新增配息</button></article>`;
    }).join('')}</div>`:`<div class="empty">${q||vf.asset?'目前沒有符合條件的投資標的':'尚未建立投資標的'}</div>`}</section></div>`;
  }

  function workdays(start,end){
    if(!start||!end)return 0; let a=new Date(start+'T00:00:00'),b=new Date(end+'T00:00:00');
    if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime()))return 0; if(a>b)return -workdays(end,start);
    let count=0; for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1)){const day=d.getDay();if(day!==0&&day!==6)count++;} return count;
  }
  function renderLunch(){
    const y=currentYear(),products=state.lunch.products, allRows=state.lunch.rows;
    const yearRows=allRows.filter(r=>yearMatch(r.date,y));
    const totals=Object.fromEntries(products.map(p=>[p.key,sum(yearRows,r=>r.costs[p.key])]));
    const filtered=filteredDataRows(allRows,ui.search.lunch||'','lunch').filter(({item})=>yearMatch(item.date,y));
    return `<div class="page-stack"><section class="kpis"><div class="kpi accent"><span>${y} 年採買紀錄</span><strong>${yearRows.length} 次</strong></div><div class="kpi"><span>${y} 年食材總支出</span><strong>${money(sum(yearRows,r=>sum(products,p=>r.costs[p.key])))}</strong></div><div class="kpi"><span>食材品項</span><strong>${products.length}</strong></div><div class="kpi"><span>${y} 年最近採買日</span><strong>${esc(yearRows.at(-1)?.date||'—')}</strong></div></section>
      <section class="card"><div class="section-head"><div><h2>${y} 年午餐花費</h2><p>天數使用工作日計算；手機可左右拖移查看完整食材欄位。</p></div><div class="chips"><button data-action="add-lunch-row">新增採買</button><button data-action="add-product">新增食材欄</button>${dateFilterBar('lunch')}</div></div><div class="table-wrap lunch-wrap"><table class="data-table lunch-table"><thead><tr><th class="date-col">日期</th><th class="numeric">天數</th><th>購買地點</th>${products.map(p=>`<th>${esc(p.name)}</th>`).join('')}<th class="numeric">工作日 $$</th><th></th></tr></thead><tbody>
        ${filtered.length?filtered.map(({item:r,index:i})=>{const next=allRows.slice(i+1).find(x=>yearMatch(x.date,y))?.date||`${y}-12-31`;const days=workdays(r.date,next);const cost=sum(products,p=>r.costs[p.key]);return `<tr><td class="date-col">${input(`lunch.rows.${i}.date`,r.date,'date')}</td><td class="numeric computed">${plain(days)}</td><td>${input(`lunch.rows.${i}.location`,r.location||'')}</td>${products.map(p=>`<td>${input(`lunch.rows.${i}.costs.${p.key}`,r.costs[p.key]||0,'number')}</td>`).join('')}<td class="numeric computed">${days?money(cost/days,2):'—'}</td><td><button class="small danger" data-action="delete" data-array="lunch.rows" data-index="${i}">刪除</button></td></tr>`}).join(''):empty(products.length+5,`${y} 年沒有採買資料`)}
        <tr class="total-row"><td>${y} 年總計</td><td></td><td></td>${products.map(p=>`<td class="numeric">${money(totals[p.key])}</td>`).join('')}<td></td><td></td></tr>
      </tbody></table></div></section>
      <section class="card"><div class="section-head"><h2>食材欄位名稱</h2></div><div class="summary-grid lunch-product-grid">${products.map((p,i)=>`<div class="summary-tile"><div class="inline-edit">${input(`lunch.products.${i}.name`,p.name)}<button class="small danger" data-action="delete-product" data-index="${i}">刪除</button></div></div>`).join('')}</div></section>
    </div>`;
  }

  function renderSettings(){
    const y=currentYear(),years=availableYears();
    const counts=years.map(year=>({year,cash:state.cash.transactions.filter(x=>yearMatch(x.date,year)).length,credit:sum(state.creditCards,c=>c.transactions.filter(x=>yearMatch(x.date,year)).length),mortgage:state.mortgage.payments.filter(x=>yearMatch(x.date,year)).length,invest:sum(state.taxesInvestments.investments,a=>a.transactions.filter(x=>yearMatch(x.date,year)).length)}));
    return `<div class="page-stack">
      <section class="card settings-hero"><div><span class="settings-kicker">目前記帳年度</span><strong>${y}</strong><p>切換後，現金、信用卡、卡費、家庭支出、分期、貸款、稅費投資與午餐頁面都會顯示該年度；含年份的標題也會同步更新。</p></div></section>
      <section class="card"><div class="section-head"><div><h2>年度設定</h2><p>年份只控制目前檢視與新增資料的預設日期，不會刪除其他年度紀錄。</p></div><button data-action="add-year">新增年份</button></div>
        <div class="form-grid settings-form"><div class="field wide"><label>當前記帳表年份</label><select data-setting-year>${years.map(x=>`<option value="${x}" ${x===y?'selected':''}>${x} 年</option>`).join('')}</select></div></div>
        <div class="formula-note">新增下一年度時，卡費銀行與家庭支出項目會沿用名稱但金額歸零；帳戶期初金額會優先承接前一年度的期末餘額。既有舊年度若沒有期初資料，預設為 0，可在「現金花費」頁修正。</div>
      </section>
      <section class="card"><div class="section-head"><div><h2>字體大小</h2><p>調整會套用到整個 App，尤其是手機版的自適應表格。</p></div></div><div class="font-scale-control"><button type="button" data-action="font-smaller" aria-label="縮小字體">－</button><strong>${Math.round((Number(state.meta.fontScale)||1)*100)}%</strong><button type="button" data-action="font-larger" aria-label="放大字體">＋</button><button type="button" class="small" data-action="font-reset">重設</button></div></section>
      <section class="card"><div class="section-head"><div><h2>記帳表顏色</h2><p>顏色設定會儲存在這台裝置，所有分頁立即套用。</p></div></div><div class="theme-grid">${THEMES.map(t=>`<button type="button" class="theme-option ${state.meta.theme===t.id?'active':''}" data-action="set-theme" data-theme="${t.id}" aria-pressed="${state.meta.theme===t.id}"><span class="theme-swatches">${t.colors.map(c=>`<i style="background:${c}"></i>`).join('')}</span><strong>${t.name}</strong><small>${state.meta.theme===t.id?'目前使用':'點選套用'}</small></button>`).join('')}</div></section>
      <section class="card no-print settings-utility-card"><div class="section-head"><div><h2>App 工具與雲端</h2><p>Google Drive、備份、匯入與列印集中放在這裡，頁面頂部只保留目前分頁名稱。</p></div></div><div id="settingsUtilitySlot" class="settings-utility-slot"></div></section>
      <section class="card"><div class="section-head"><div><h2>可用年度</h2><p>以下年份由既有日期資料與已建立的年度帳本自動整理。</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>年份</th><th class="numeric">現金交易</th><th class="numeric">信用卡交易</th><th class="numeric">貸款還款</th><th class="numeric">投資配息</th><th></th></tr></thead><tbody>${counts.map(x=>`<tr class="${x.year===y?'active-year-row':''}"><td><strong>${x.year}</strong></td><td class="numeric">${x.cash}</td><td class="numeric">${x.credit}</td><td class="numeric">${x.mortgage}</td><td class="numeric">${x.invest}</td><td><button class="small ${x.year===y?'primary':''}" data-action="switch-year" data-year="${x.year}">${x.year===y?'目前年度':'切換'}</button></td></tr>`).join('')}</tbody></table></div></section>
    </div>`;
  }

  const sidebar=document.querySelector('.sidebar');
  const sidebarBackdrop=document.getElementById('sidebarBackdrop');
  const drawerMedia=window.matchMedia('(max-width: 760px), (orientation: landscape) and (max-height: 600px)');
  let sidebarScrollLock=null;
  function lockPageForSidebar(){
    if(sidebarScrollLock)return;
    const body=document.body,scrollY=window.scrollY||document.documentElement.scrollTop||0;
    sidebarScrollLock={scrollY,position:body.style.position,top:body.style.top,left:body.style.left,right:body.style.right,width:body.style.width,overflow:body.style.overflow};
    body.style.position='fixed';body.style.top=`-${scrollY}px`;body.style.left='0';body.style.right='0';body.style.width='100%';body.style.overflow='hidden';
  }
  function unlockPageForSidebar(){
    if(!sidebarScrollLock)return;
    const body=document.body,lock=sidebarScrollLock;sidebarScrollLock=null;
    body.style.position=lock.position;body.style.top=lock.top;body.style.left=lock.left;body.style.right=lock.right;body.style.width=lock.width;body.style.overflow=lock.overflow;
    window.scrollTo(0,lock.scrollY);
  }
  function setSidebarOpen(open){
    const shouldOpen=Boolean(open&&drawerMedia.matches);
    sidebar.classList.toggle('open',shouldOpen);
    sidebarBackdrop?.classList.toggle('open',shouldOpen);
    sidebarBackdrop?.setAttribute('aria-hidden',String(!shouldOpen));
    document.body.classList.toggle('sidebar-open',shouldOpen);
    document.documentElement.classList.toggle('sidebar-open',shouldOpen);
    document.getElementById('menuBtn')?.setAttribute('aria-expanded',String(shouldOpen));
    if(shouldOpen)lockPageForSidebar();else unlockPageForSidebar();
  }
  function toggleSidebar(){setSidebarOpen(!sidebar.classList.contains('open'));}
  nav.addEventListener('click',e=>{
    const btn=e.target.closest('[data-tab]');if(!btn)return;
    const nextTab=btn.dataset.tab;if(!TABS.some(t=>t[0]===nextTab))return;
    const changed=ui.tab!==nextTab;ui.tab=nextTab;setSidebarOpen(false);render();
    if(changed)requestAnimationFrame(()=>{
      window.scrollTo({top:0,left:0,behavior:'auto'});
      main.querySelectorAll('.table-wrap').forEach(w=>{w.scrollLeft=0;});
    });
  });
  // iOS standalone/landscape can suppress the synthetic click after a tiny touch move.
  // Treat a stationary touch as an explicit tab tap, while allowing normal vertical scrolling.
  let navTouchTap=null;
  nav.addEventListener('touchstart',e=>{
    const btn=e.target.closest('[data-tab]');if(!btn||e.touches.length!==1){navTouchTap=null;return;}
    const t=e.touches[0];navTouchTap={btn,x:t.clientX,y:t.clientY};
  },{passive:true});
  nav.addEventListener('touchmove',e=>{
    if(!navTouchTap||e.touches.length!==1)return;
    const t=e.touches[0];
    if(Math.abs(t.clientX-navTouchTap.x)>12||Math.abs(t.clientY-navTouchTap.y)>12)navTouchTap=null;
  },{passive:true});
  nav.addEventListener('touchend',e=>{
    if(!navTouchTap){return;}
    const btn=navTouchTap.btn;navTouchTap=null;
    e.preventDefault();btn.click();
  },{passive:false});
  nav.addEventListener('touchcancel',()=>{navTouchTap=null;},{passive:true});
  document.getElementById('menuBtn').addEventListener('click',toggleSidebar);
  sidebarBackdrop?.addEventListener('click',()=>setSidebarOpen(false));
  drawerMedia.addEventListener?.('change',()=>setSidebarOpen(false));

  let sidebarGesture=null;
  document.addEventListener('touchstart',e=>{
    if(!drawerMedia.matches||e.touches.length!==1)return;
    const target=e.target instanceof Element?e.target:null;
    if(target?.closest('button,a,input,select,textarea,label,[role="button"]')){sidebarGesture=null;return;}
    const t=e.touches[0];
    sidebarGesture={x:t.clientX,y:t.clientY,open:sidebar.classList.contains('open'),fromLeftEdge:t.clientX<=30};
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!drawerMedia.matches||!sidebarGesture||e.touches.length!==1)return;
    const t=e.touches[0],dx=t.clientX-sidebarGesture.x,dy=t.clientY-sidebarGesture.y;
    const targetInSidebar=e.target instanceof Element&&Boolean(e.target.closest('.sidebar'));
    if(sidebar.classList.contains('open')){
      if(!targetInSidebar)e.preventDefault();
      else if(Math.abs(dx)>24&&Math.abs(dx)>Math.abs(dy)*1.25)e.preventDefault();
    }else if(sidebarGesture.fromLeftEdge&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.15){
      e.preventDefault();
    }
  },{passive:false});
  document.addEventListener('touchend',e=>{
    if(!sidebarGesture||!drawerMedia.matches||e.changedTouches.length!==1){sidebarGesture=null;return;}
    const t=e.changedTouches[0],dx=t.clientX-sidebarGesture.x,dy=t.clientY-sidebarGesture.y;
    const horizontal=Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.15;
    if(horizontal){
      if(sidebarGesture.open&&dx<0)setSidebarOpen(false);
      else if(!sidebarGesture.open&&sidebarGesture.fromLeftEdge&&dx>0)setSidebarOpen(true);
    }
    sidebarGesture=null;
  },{passive:true});
  document.addEventListener('touchcancel',()=>{sidebarGesture=null;},{passive:true});
  let searchComposing=false;
  function handleSearchInput(){
    ui.search[ui.tab]=searchInput.value;
    ui.page[ui.tab]=1;
    saveUiPrefs();
    clearTimeout(searchInput._t);
    if(searchComposing)return;
    const tabAtInput=ui.tab;
    searchInput._t=setTimeout(()=>{if(ui.tab===tabAtInput)renderSearchResults();},180);
  }
  searchInput.addEventListener('compositionstart',()=>{searchComposing=true;clearTimeout(searchInput._t);});
  searchInput.addEventListener('compositionend',()=>{searchComposing=false;handleSearchInput();});
  searchInput.addEventListener('input',handleSearchInput);

  main.addEventListener('change',e=>{
    const el=e.target;
    if(el.matches?.('.app-date-native'))updateDateControlDisplay(el);
    if(el.dataset.settingTheme!==undefined){
      const theme=el.value;if(THEMES.some(t=>t.id===theme)){captureUndo('更改主題');state.meta.theme=theme;scheduleSave();applyTheme();}return;
    }
    if(el.dataset.settingYear!==undefined){
      const y=normalizeYear(el.value);if(y){captureUndo('切換記帳年度');state.meta.currentYear=y;state.meta.year=y;ensureYearStructure(y);ui.page={};scheduleSave();renderPreservingAnchor(el);}return;
    }
    if(el.dataset.includeUndatedScope!==undefined){
      const scope=el.dataset.includeUndatedScope;ui.includeUndated[scope]=!!el.checked;
      if(scope==='cash')ui.page.cash=1;else if(scope==='credit')ui.page[`credit-${ui.activeCard}`]=1;
      saveUiPrefs();renderPreservingAnchor(el);return;
    }
    if(el.dataset.bulkPaid!==undefined){
      const cardIndex=Number(el.dataset.bulkPaid),card=state.creditCards[cardIndex];if(!card)return;
      captureUndo(el.checked?'批次標記信用卡已繳':'批次取消信用卡已繳');
      const key=`credit-${cardIndex}`,q=ui.search.credit||'';
      const includeUndated=!!ui.includeUndated.credit;
      filteredDataRows(card.transactions,q,key,x=>x.date,includeUndated).filter(({item})=>yearMatch(item.date)||(includeUndated&&!String(item.date||'').trim())).forEach(({item})=>item.paid=el.checked);
      scheduleSave();toast(el.checked?'已全選目前篩選結果':'已取消目前篩選結果');renderPreservingAnchor(el);return;
    }
    if(el.dataset.bulkCashSelectAll!==undefined){
      currentCashFilteredRows().forEach(({item})=>el.checked?ui.cashSelection.add(item.id):ui.cashSelection.delete(item.id));
      updateCashSelectionControls();
      toast(el.checked?'已全選目前篩選結果':'已取消目前篩選結果');return;
    }
    if(el.dataset.cashSelect!==undefined){
      el.checked?ui.cashSelection.add(el.dataset.cashSelect):ui.cashSelection.delete(el.dataset.cashSelect);
      updateCashSelectionControls();return;
    }
    if(el.dataset.filterKey){
      const key=el.dataset.filterKey;ui.dateFilters[key]=ui.dateFilters[key]||{};ui.dateFilters[key][el.dataset.filterSide]=el.value;ui.page[key]=1;renderPreservingAnchor(el);return;
    }
    if(el.dataset.viewFilterPage){
      const page=el.dataset.viewFilterPage,field=el.dataset.viewFilterField;ui.viewFilters[page]=ui.viewFilters[page]||{};ui.viewFilters[page][field]=el.value;ui.page[page]=1;renderPreservingAnchor(el);return;
    }
    if(el.matches('form[data-form="cash"] input[name="date"]')){
      const reportMode=el.form?.elements?.reportMode;
      if(reportMode && String(el.value||'')>today()) reportMode.value='neutral';
      return;
    }
    if(!el.dataset.path)return;
    captureUndo('修改資料');
    let value=el.type==='checkbox'?el.checked:el.value;
    if(el.type==='number') value=value===''?0:n(value);
    if(value==='true')value=true; else if(value==='false')value=false;
    setPath(el.dataset.path,value);
    const m=el.dataset.path.match(/^cash\.transactions\.(\d+)\.date$/);if(m){
      const tx=state.cash.transactions[Number(m[1])];
      tx.reportMonth=value?(Number(String(value).slice(5,7))||0):0;
      if(String(value||'')>today())tx.monthlyFlow='neutral';
    }
    if(el.type==='date')sortAllDatedCollections(state);
    scheduleSave();
    if(/^cash\.transactions\.\d+\.rowColor$/.test(el.dataset.path)){
      const tr=el.closest('tr');if(tr)tr.dataset.rowColor=validRowColor(value);
      return;
    }
    renderPreservingAnchor(el);
  });
  main.addEventListener('submit',e=>{
    const form=e.target.closest('form[data-form]'); if(!form)return; e.preventDefault(); const fd=Object.fromEntries(new FormData(form));
    let addedCashId='';
    if(form.dataset.form==='credit-card'){
      const bank=String(fd.bank||'').trim(),title=String(fd.title||'').trim();
      if(!bank||!title)return;
      captureUndo('新增信用卡卡別');
      state.creditCards.push({id:uid('card'),bank,title,limit:n(fd.limit),transactions:[],templates:[]});
      ui.activeCard=state.creditCards.length-1;ui.showAddCard=false;ui.deleteCardIndex=null;
    }
    if(form.dataset.form==='cash'){
      captureUndo('新增現金交易');
      const y=currentYear();
      const rawDate=String(fd.date||'').trim();
      let date=rawDate?normalizeDateValue(rawDate,defaultDateForYear()):'';
      if(date&&txYear(date)!==y)date=defaultDateForYear();
      addedCashId=uid('cash');
      state.cash.transactions.unshift({id:addedCashId,date,category:String(fd.category||'').trim(),description:String(fd.description||'').trim(),amount:n(fd.amount),account:fd.account,monthlyFlow:date&&String(date)>today()?'neutral':(fd.reportMode==='neutral'?'neutral':'auto'),reportMonth:date?(Number(date.slice(5,7))||0):0,rowColor:validRowColor(fd.rowColor),createdAt:new Date().toISOString()});
      state.meta.years=Array.from(new Set([...(state.meta.years||[]),y])).sort((a,b)=>b-a);
      ui.revealCashId=addedCashId;if(!date)ui.includeUndated.cash=true;
    }
    if(form.dataset.form==='credit'){captureUndo('新增信用卡交易');const date=String(fd.date||'').trim();state.creditCards[ui.activeCard].transactions.push({id:uid('cc'),date,description:fd.description,amount:n(fd.amount),store:fd.store,card:fd.card,fee:n(fd.fee),paid:false,monthlyFlow:'auto',rowColor:''});if(!date)ui.includeUndated.credit=true;}
    if(form.dataset.form==='mortgage'){ captureUndo('新增貸款還款'); const acc=state.mortgage.accounts.find(a=>a.name===fd.account); state.mortgage.payments.push({id:uid('mort'),date:fd.date,category:'貸款還款',description:fd.description,amount:n(fd.amount),account:fd.account,loanType:String(fd.loanType||acc?.loanType||'').trim()}); }
    sortAllDatedCollections(state);
    if(addedCashId){
      const revealRows=currentCashFilteredRows();
      const revealIndex=revealRows.findIndex(({item})=>item.id===addedCashId);
      if(revealIndex>=0)ui.page.cash=Math.floor(revealIndex/70)+1;
    }
    scheduleSave(); toast(addedCashId?'已新增並列入現金花費':'已新增'); render();
    if(addedCashId)requestAnimationFrame(()=>{
      const row=[...main.querySelectorAll('[data-cash-id]')].find(x=>x.dataset.cashId===addedCashId);
      if(row){
        const topbar=document.querySelector('.topbar');
        const offset=(topbar?.getBoundingClientRect().height||0)+12;
        window.scrollBy({top:row.getBoundingClientRect().top-offset,left:0,behavior:'auto'});
      }
      ui.revealCashId=null;
    });
  });
  main.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]'); if(!b)return; const a=b.dataset.action;
    if(a==='toggle-credit-total-mode'){
      const path=b.dataset.path;if(!path)return;
      const next=normalizeReportMode(b.dataset.mode)==='neutral'?'auto':'neutral';
      captureUndo('切換信用卡統計');
      setPath(path,next);scheduleSave();b.dataset.mode=next;b.classList.toggle('neutral',next==='neutral');b.classList.toggle('auto',next==='auto');
      b.innerHTML=reportModeIcon(next);b.title=creditTotalModeLabel(next);b.setAttribute('aria-label',creditTotalModeLabel(next));
      renderPreservingAnchor(b);return;
    }
    if(a==='toggle-report-mode'){
      const path=b.dataset.path;if(!path)return;
      const next=normalizeReportMode(b.dataset.mode)==='neutral'?'auto':'neutral';
      captureUndo('切換月報處理');
      setPath(path,next);scheduleSave();b.dataset.mode=next;b.classList.toggle('neutral',next==='neutral');b.classList.toggle('auto',next==='auto');
      b.innerHTML=reportModeIcon(next);b.title=reportModeLabel(next);b.setAttribute('aria-label',reportModeLabel(next));return;
    }
    if(a==='delete'){
      if(!confirm('確定刪除這筆資料？'))return; const arr=getPath(b.dataset.array); if(!Array.isArray(arr))return; captureUndo('刪除資料'); arr.splice(Number(b.dataset.index),1); scheduleSave(); render(); return;
    }
    if(a==='page'){ui.page[b.dataset.key]=Number(b.dataset.page);render();return;}
    if(a==='clear-date-filter'){ui.dateFilters[b.dataset.key]={};ui.page[b.dataset.key]=1;render();return;}
    if(a==='toggle-credit-unpaid'){ui.creditUnpaidOnly=!ui.creditUnpaidOnly;ui.page[`credit-${ui.activeCard}`]=1;saveUiPrefs();render();return;}
    if(a==='clear-view-filters'){const page=b.dataset.page;ui.viewFilters[page]={};ui.page[page]=1;render();return;}
    if(a==='clear-cash-selection'){ui.cashSelection.clear();renderPreservingAnchor(b);return;}
    if(a==='apply-cash-bulk'){
      if(!ui.cashSelection.size){toast('請先勾選要修改的資料');return;}
      const report=main.querySelector('[data-bulk-cash-report]')?.value||'__keep__';
      const color=main.querySelector('[data-bulk-cash-color]')?.value||'__keep__';
      if(report==='__keep__'&&color==='__keep__'){toast('請選擇要修改的月報處理或顏色');return;}
      captureUndo('批次修改現金交易');
      let changed=0;
      state.cash.transactions.forEach(t=>{
        if(!ui.cashSelection.has(t.id))return;
        if(report!=='__keep__')t.monthlyFlow=report==='neutral'?'neutral':'auto';
        if(color!=='__keep__')t.rowColor=color==='__none__'?'':validRowColor(color);
        changed++;
      });
      ui.cashSelection.clear();scheduleSave();toast(`已批次更新 ${changed} 筆資料`);renderPreservingAnchor(b);return;
    }
    if(a==='add-cash-template'){captureUndo('新增固定現金項目');state.cash.templates.push({id:uid('cashtpl'),category:'固定支出',description:'',amount:0,account:state.cash.accounts[0]?.name||'',reportMode:'auto'});}
    if(a==='use-cash-template'){const t=state.cash.templates[Number(b.dataset.index)];fillForm('cash',{category:t.category,description:t.description,amount:t.amount,account:t.account,reportMode:t.reportMode});toast('已帶入新增欄');return;}
    if(a==='copy-cash-template'){const t=state.cash.templates[Number(b.dataset.index)];copyText([t.category,t.description,t.amount,t.account,t.reportMode==='neutral'?'不列入月報':'依正負號'].join('\t'));return;}
    if(a==='add-credit-template'){captureUndo('新增固定信用卡支出');state.creditCards[ui.activeCard].templates.push({id:uid('cctpl'),description:'固定支出',amount:0,store:'',card:'',fee:0});}
    if(a==='use-credit-template'){const t=state.creditCards[ui.activeCard].templates[Number(b.dataset.index)];fillForm('credit',{description:t.description,amount:t.amount,store:t.store,card:t.card,fee:t.fee});toast('已帶入新增欄');return;}
    if(a==='copy-credit-template'){const t=state.creditCards[ui.activeCard].templates[Number(b.dataset.index)];copyText([t.description,t.amount,t.store,t.card,t.fee].join('\t'));return;}
    if(a==='complete-installment'){
      const index=Number(b.dataset.index),it=state.installments[index];
      if(!it){toast('找不到這筆分期，請重新開啟分期頁');render();return;}
      captureUndo('完成分期');
      state.installments.splice(index,1);
      const archived=clone(it);archived.completedAt=defaultDateForYear();archived.year=currentYear();state.installmentHistory.unshift(archived);
      sortAllDatedCollections(state);
      scheduleSave();toast('已移入歷史紀錄，可在下方恢復');render();return;
    }
    if(a==='restore-installment'){
      const index=Number(b.dataset.index),it=state.installmentHistory[index];
      if(!it){toast('找不到這筆歷史紀錄');render();return;}
      captureUndo('恢復分期');
      state.installmentHistory.splice(index,1);const restored=clone(it);delete restored.completedAt;restored.year=currentYear();state.installments.push(restored);
      scheduleSave();toast('已恢復為進行中');render();return;
    }
    if(a==='set-card'){ui.activeCard=Number(b.dataset.index);ui.deleteCardIndex=null;render();return;}
    if(a==='add-account'){const name=prompt('帳戶名稱');if(name){captureUndo('新增現金帳戶');state.cash.accounts.push({id:uid('acc'),name,initial:0,initialByYear:{[String(currentYear())]:0},note:'',includeInTwdTotal:true});}}
    if(a==='add-card'){ui.showAddCard=true;ui.deleteCardIndex=null;render();setTimeout(()=>main.querySelector('[data-form="credit-card"] input[name="bank"]')?.focus(),0);return;}
    if(a==='cancel-add-card'){ui.showAddCard=false;render();return;}
    if(a==='delete-card'){ui.deleteCardIndex=Number(b.dataset.index);ui.showAddCard=false;render();return;}
    if(a==='cancel-delete-card'){ui.deleteCardIndex=null;render();return;}
    if(a==='confirm-delete-card'){const index=Number(b.dataset.index);const title=state.creditCards[index]?.title||'此卡別';captureUndo(`刪除卡別「${title}」`);state.creditCards.splice(index,1);ui.activeCard=Math.max(0,Math.min(index-1,state.creditCards.length-1));ui.deleteCardIndex=null;toast(`已刪除 ${title}`);}
    if(a==='add-fee-bank'){const name=prompt('銀行名稱');if(name){captureUndo('新增卡費銀行');currentCardFeeBook().banks.push({id:uid('bank'),bank:name,months:Array(12).fill(0)});}}
    if(a==='add-fee-history'){const year=prompt('年度');if(year){captureUndo('新增歷年卡費');state.cardFees.history.unshift({year,months:Array(12).fill(0)});}}
    if(a==='add-home-item'){const item=prompt('支出項目');if(item){captureUndo('新增家庭支出項目');currentHomeBook().items.push({id:uid('home'),item,months:Array(12).fill(0)});}}
    if(a==='add-home-history'){const year=prompt('年度');if(year){captureUndo('新增家庭支出年度');state.homeExpenses.history.unshift({year,months:Array(12).fill(0)});}}
    if(a==='add-installment'){captureUndo('新增分期');state.installments.push({id:uid('inst'),year:currentYear(),title:'新分期',total:0,account:'',plans:[{label:'一期',amount:0,schedule:''}],note:''});}
    if(a==='add-plan'){captureUndo('新增分期期別');state.installments[Number(b.dataset.index)].plans.push({label:'',amount:0,schedule:''});}
    if(a==='add-mortgage-account'){const name=prompt('貸款帳戶名稱');if(name){captureUndo('新增貸款帳戶');state.mortgage.accounts.push({id:uid('mortacc'),name,loanType:'',principal:0,note:''});}}
    if(a==='add-tax'){captureUndo('新增稅費資料');state.taxesInvestments.taxes.push({id:uid('tax'),year:String(currentYear()),houseTax:0,insurance:0,incomeTax:0,landTax:0});}
    if(a==='add-asset'){const name=prompt('投資標的名稱');if(name){captureUndo('新增投資標的');state.taxesInvestments.investments.push({id:uid('asset'),name,transactions:[]});}}
    if(a==='add-invest-tx'){captureUndo('新增投資配息');state.taxesInvestments.investments[Number(b.dataset.index)].transactions.push({id:uid('inv'),date:defaultDateForYear(),amount:0});}
    if(a==='add-lunch-row'){captureUndo('新增午餐採買');state.lunch.rows.push({id:uid('lunch'),date:defaultDateForYear(),location:'',costs:Object.fromEntries(state.lunch.products.map(p=>[p.key,0]))});}
    if(a==='add-product'){const name=prompt('食材名稱');if(name){captureUndo('新增午餐食材欄');const key=uid('p').replaceAll('-','_');state.lunch.products.push({key,name});state.lunch.rows.forEach(r=>r.costs[key]=0);}}
    if(a==='delete-product'){const i=Number(b.dataset.index),p=state.lunch.products[i];if(!confirm(`刪除「${p.name}」欄及其所有金額？`))return;captureUndo(`刪除食材欄「${p.name}」`);state.lunch.products.splice(i,1);state.lunch.rows.forEach(r=>delete r.costs[p.key]);}
    if(a==='font-smaller'){captureUndo('縮小字體');state.meta.fontScale=Math.max(.85,Math.round(((Number(state.meta.fontScale)||1)-.05)*100)/100);scheduleSave();renderPreservingAnchor(b);return;}
    if(a==='font-larger'){captureUndo('放大字體');state.meta.fontScale=Math.min(1.30,Math.round(((Number(state.meta.fontScale)||1)+.05)*100)/100);scheduleSave();renderPreservingAnchor(b);return;}
    if(a==='font-reset'){captureUndo('重設字體大小');state.meta.fontScale=1;scheduleSave();renderPreservingAnchor(b);return;}
    if(a==='set-theme'){const theme=b.dataset.theme;if(THEMES.some(t=>t.id===theme)){captureUndo('更改主題');state.meta.theme=theme;applyTheme();toast(`已套用 ${THEMES.find(t=>t.id===theme).name}`);}}
    if(a==='switch-year'){const y=normalizeYear(b.dataset.year);if(y){captureUndo('切換記帳年度');state.meta.currentYear=y;state.meta.year=y;ensureYearStructure(y);ui.page={};toast(`已切換到 ${y} 年`);}}
    if(a==='add-year'){const raw=prompt('輸入西元年份，例如 2027');const y=normalizeYear(raw);if(!y||y<1900||y>2200){if(raw!==null)alert('請輸入 1900～2200 的西元年份。');return;}captureUndo('新增記帳年度');ensureYearStructure(y);state.meta.currentYear=y;state.meta.year=y;ui.page={};toast(`已建立並切換到 ${y} 年`);}
    sortAllDatedCollections(state);
    scheduleSave(); render();
  });

  undoDeleteBtn?.addEventListener('click',undoLastAction);

  settingsToolbar.addEventListener('click',e=>{
    const b=e.target.closest('[data-global-action]'); if(!b)return;
    if(b.dataset.globalAction==='export'){
      downloadJson(state,`財務追蹤_全年度備份_${today()}.json`);toast('備份已下載');
    }
    if(b.dataset.globalAction==='restore-import')restorePreImport();
    if(b.dataset.globalAction==='print')window.print();
    if(b.dataset.globalAction==='reset'){
      if(!confirm(APP_CONFIG.resetConfirm||'這會清除 App 內的修改，還原成最初內容。確定繼續？'))return; captureUndo('還原原始資料前的內容'); state=migrateState(clone(initial)); localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(UI_STORAGE_KEY); ui.search={};ui.page={};ui.dateFilters={};ui.viewFilters={cash:{},mortgage:{},tax:{},investment:{}};ui.includeUndated={cash:false,credit:false}; scheduleSave();render();
    }
  });
  function loadImportFile(file,forcedMode=''){
    if(!file)return;const reader=new FileReader();
    reader.onload=()=>{
      try{
        const raw=JSON.parse(reader.result);const validation=backupValidation(raw);
        const detected=isHistoryMergePackage(raw)?'history-merge':'overwrite';const mode=forcedMode||detected;
        if(forcedMode==='history-merge'&&!isHistoryMergePackage(raw)){validation.errors.push('這不是「歷史資料合併包」，請改用一般「安全匯入」。');validation.compatible=false;}
        let normalized;try{normalized=migrateState(clone(raw));}catch(err){validation.errors.push('資料轉換失敗，檔案可能已損壞。');validation.compatible=false;normalized=migrateState({meta:{year:new Date().getFullYear()},cash:{accounts:[],transactions:[]}});}
        pendingImport={raw,normalized,validation,fileName:file.name,fileSize:file.size,mode};showImportPreview();
      }catch(_){alert('無法解析這個檔案。請選擇財務追蹤 App 的 JSON 備份或歷史資料合併包。');}
    };
    reader.onerror=()=>alert('讀取匯入檔失敗，請重新選擇檔案。');reader.readAsText(file);
  }
  document.getElementById('importFile')?.addEventListener('change',e=>{const file=e.target.files[0];loadImportFile(file);e.target.value='';});
  document.getElementById('historyImportFile')?.addEventListener('change',e=>{const file=e.target.files[0];loadImportFile(file,'history-merge');e.target.value='';});
  importDialog?.addEventListener('click',e=>{
    const action=e.target.closest('[data-import-action]')?.dataset.importAction;
    if(action==='cancel')closeImportDialog();
    if(action==='confirm')performSafeImport();
    if(e.target===importDialog)closeImportDialog();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&importDialog&&!importDialog.hidden)closeImportDialog();});

  window.FinanceTrackerApp = {
    getState:()=>clone(state),
    getLocalUpdatedAt:()=>state.meta?.updatedAt||'',
    getSchemaVersion:()=>CURRENT_SCHEMA,
    getStorageKey:()=>STORAGE_KEY,
    validateBackup:raw=>backupValidation(raw),
    summarizeState:raw=>backupSummary(migrateState(clone(raw))),
    migrateState:raw=>migrateState(clone(raw)),
    setSaveStatus:text=>{saveStatus.textContent=text;},
    toast,
    downloadJson,
    fileStamp,
    createCloudRollback(provider='cloud'){
      const snapshot={createdAt:new Date().toISOString(),provider,data:clone(state)};
      localStorage.setItem(CLOUD_ROLLBACK_KEY,JSON.stringify(snapshot));
      return snapshot;
    },
    getCloudRollback(){
      try{return JSON.parse(localStorage.getItem(CLOUD_ROLLBACK_KEY)||'null');}catch(_){return null;}
    },
    clearCloudRollback(){localStorage.removeItem(CLOUD_ROLLBACK_KEY);},
    replaceStateFromCloud(raw,remoteUpdatedAt=''){
      const validation=backupValidation(raw);
      if(!validation.compatible)throw new Error(validation.errors.join(' ')||'雲端資料格式不相容。');
      const incoming=migrateState(clone(raw));
      captureUndo('載入雲端資料');
      if(remoteUpdatedAt)incoming.meta.updatedAt=remoteUpdatedAt;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(incoming));
      state=incoming;
      ui.dateFilters={};ui.page={};ui.activeCard=0;ui.showAddCard=false;ui.deleteCardIndex=null;
      render();
      return clone(state);
    },
    restoreCloudRollback(){
      let snapshot;
      try{snapshot=JSON.parse(localStorage.getItem(CLOUD_ROLLBACK_KEY)||'null');}catch(_){snapshot=null;}
      if(!snapshot?.data)throw new Error('找不到可復原的雲端同步前資料。');
      const restored=migrateState(clone(snapshot.data));
      captureUndo('復原雲端同步前資料');
      localStorage.setItem(STORAGE_KEY,JSON.stringify(restored));
      state=restored;localStorage.removeItem(CLOUD_ROLLBACK_KEY);
      ui.dateFilters={};ui.page={};ui.activeCard=0;ui.showAddCard=false;ui.deleteCardIndex=null;
      render();
      return {createdAt:snapshot.createdAt,provider:snapshot.provider};
    }
  };

  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  render();
})();
