import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSignIn} from '../packages/security/native-login.js';
function options(change={}){let n=0;return {baseUrl:'https://api.example',redirectUri:'irmrmsdemo://auth',randomHex:()=>String(++n===1?'a':'b').repeat(64),challengeFor:async()=> 'c'.repeat(43),openSession:async(url,redirect)=>{assert.ok(!url.includes('accessToken'));assert.equal(new URL(url).searchParams.get('returnOrigin'),redirect);return {type:'success',url:redirect+'#'+new URLSearchParams({state:'b'.repeat(64),irm_login_code:'d'.repeat(64)})}},fetchImpl:async(url,request)=>{assert.equal(url,'https://api.example/auth/exchange');assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.equal(JSON.parse(request.body).verifier,'a'.repeat(64));return new Response(JSON.stringify({accessToken:'irm_session_native',expiresAt:Date.now()+60000}),{status:201})},...change}}
test('native browser sign-in exchanges a state-bound PKCE code without putting a bearer token in the URL',async()=>{
 const session=await nativeSignIn(options());assert.equal(session.accessToken,'irm_session_native');assert.equal(session.baseUrl,'https://api.example');
});
test('native sign-in rejects cancellation, wrong schemes, wrong state and insecure endpoints',async()=>{
 for(const change of [{baseUrl:'http://api.example'},{redirectUri:'evil://auth'},{openSession:async()=>({type:'cancel'})},{openSession:async()=>({type:'success',url:'irmrmsdemo://evil#state='+'b'.repeat(64)})},{openSession:async()=>({type:'success',url:'irmrmsdemo://auth#state=wrong&irm_login_code='+'d'.repeat(64)})}])await assert.rejects(nativeSignIn(options(change)));
});
test('desktop sign-in opens the system browser and accepts only its registered callback scheme',async()=>{
 const {startLogin,bindDesktopLogin}=await import('../src/login.js');const map=new Map(),storage={setItem:(k,v)=>map.set(k,v),getItem:k=>map.get(k),removeItem:k=>map.delete(k)};let opened,listener,received;
 const desktop={core:{invoke:async(command,args)=>{if(command==='plugin:opener|open_url'){opened=args.url;return}if(command==='plugin:deep-link|get_current')return []}},event:{listen:async(name,callback)=>{assert.equal(name,'deep-link://new-url');listener=callback;return ()=>{}}}};
 await startLogin('https://api.example',{storage,location:{origin:'http://tauri.localhost'},desktop});const login=new URL(opened);assert.equal(login.searchParams.get('returnOrigin'),'irmrmsdesktop://auth');
 const previous=globalThis.fetch;globalThis.sessionStorage=storage;globalThis.fetch=async()=>new Response(JSON.stringify({accessToken:'irm_session_desktop'}));
 try{await bindDesktopLogin(value=>{received=value},error=>{throw error},{desktop});await listener({payload:['evil://auth#irm_login_code=ignored']});assert.equal(received,undefined);await listener({payload:['irmrmsdesktop://auth#'+new URLSearchParams({state:login.searchParams.get('state'),irm_login_code:'d'.repeat(64)})]});assert.equal(received.accessToken,'irm_session_desktop');assert.equal(map.size,0)}finally{globalThis.fetch=previous;delete globalThis.sessionStorage}
});
