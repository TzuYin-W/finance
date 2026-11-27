const CACHE='finance-tracker-20261127-v53-drawer-chrome-fix';
const ASSETS=[
  './','./index.html','./manifest.webmanifest',
  './icon-192-v49.png','./icon-512-v49.png','./apple-touch-icon-v49.png',
  './favicon-v49.ico','./favicon-32-v49.png','./favicon-16-v49.png'
];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  await Promise.allSettled(ASSETS.map(u=>c.add(u)));
  await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
