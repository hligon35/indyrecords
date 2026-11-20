const CACHE='irm-time-clock-shell-v1';
const FILES=['/','/app.js','/styles.css','/offline-vault.js','/manifest.webmanifest'];

async function refreshShell() {
 const cache=await caches.open(CACHE);
 await cache.addAll(FILES.map(path=>new Request(path,{credentials:'same-origin',redirect:'error',cache:'reload'})));
}

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  await refreshShell();
  await self.skipWaiting();
 })());
});

self.addEventListener('message',event=>{
 if(event.data==='refresh-shell')event.waitUntil(refreshShell());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('irm-time-clock-shell-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
 })());
});

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!FILES.includes(url.pathname))return;
 event.respondWith((async()=>{
  try { return await fetch(request); }
  catch {
   const cache=await caches.open(CACHE);
   return await cache.match(url.pathname) || Response.error();
  }
 })());
});
