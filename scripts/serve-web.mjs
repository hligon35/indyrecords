// Loopback-only static preview used by Tauri development. Never serves the repository.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import './build-web.mjs';
const root=resolve(import.meta.dirname,'../dist/web');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403).end();return}
  const target=path===root?resolve(root,'index.html'):path;
  const data=await readFile(target);
  res.writeHead(200,{'content-type':types[extname(target)]||'application/octet-stream','cache-control':'no-store'}).end(data);
 }catch{res.writeHead(404).end()}
}).listen(4173,'127.0.0.1',()=>console.log('Synthetic preview: http://127.0.0.1:4173'));
