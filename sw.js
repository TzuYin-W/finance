const CACHE='finance-tracker-20260813-pikmin-pokemon-redesign-v10-force';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192-v10.png','./icons/icon-512-v10.png','./icons/apple-touch-icon-v10.png','./assets/themes/monchhichi/monchhichi-bg.png','./assets/themes/monchhichi/monchhichi-sidebar.png','./assets/themes/monchhichi/monchhichi-bg-landscape.png','./assets/themes/pokemon/pokemon-bg-v10.png','./assets/themes/pokemon/pokemon-bg-landscape-v10.png','./assets/themes/pikmin/pikmin-bg-v10.png','./assets/themes/pikmin/pikmin-bg-landscape-v10.png','./assets/themes/pikmin/pikmin-sidebar-v10.png','./assets/themes/pokemon/pokemon-sidebar-v10.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
