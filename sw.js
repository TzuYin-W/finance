const CACHE='finance-tracker-v19-unique-art-layout';
const ASSETS=['./','./index.html','./styles.css','./initial-data.js','./app.js','./cloud-sync.js','./manifest.webmanifest','./icon.svg','./theme-pikmin-sidebar.png','./theme-pikmin-right.png','./theme-pikmin-corner.png','./theme-pokemon-right.png','./theme-pokemon-corner.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.match(event.request)));
});
