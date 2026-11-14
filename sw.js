// Static shell caching for fictional demo only. API requests are NEVER cached.
// Bump version when static assets change. This does not provide durable scan sync.
const CACHE='irm-rms-static-v3';
const ASSETS=['./','./index.html','./styles.css','./src/app.js','./src/domain.js','./src/remote-readonly.js','./src/login.js','./src/warehouse-view.js','./packages/warehouse/workflows.js','./packages/api-client/index.js','./manifest.webmanifest','./assets/irm-icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('irm-rms-static-')&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim()})())});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 const url=new URL(req.url);
 if((url.pathname.startsWith('/v1/')||url.pathname.startsWith('/auth/'))||url.pathname==='/health')return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return}
 if(!ASSETS.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
});
