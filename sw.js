const CACHE='finance-tracker-20260813-github-root-v14-gundam-portrait-fix';
const ASSETS=[
  './','./index.html','./manifest.webmanifest',
  './icon-192-v11.png','./icon-512-v11.png','./apple-touch-icon-v11.png',
  './monchhichi-bg.png','./monchhichi-bg-landscape.png','./monchhichi-sidebar.png',
  './pikmin-bg-v11.png','./pikmin-bg-landscape-v11.png','./pikmin-sidebar-v11.png',
  './gundam-bg-v14.png','./gundam-bg-landscape-v14.png','./gundam-sidebar-v14.png'
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
