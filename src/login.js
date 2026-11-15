const KEY='irm-rms-login-pkce';
function random(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function startLogin(baseUrl,{storage=sessionStorage,location=window.location,desktop=window.__TAURI__}={}){
 const api=new URL(baseUrl);
 if(api.origin!==baseUrl||api.protocol!=='https:')throw Error('Use the approved HTTPS API origin for login');
 const verifier=random(),state=random();
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 storage.setItem(KEY,JSON.stringify({baseUrl,verifier,state,createdAt:Date.now()}));
 const target=baseUrl+'/auth/login?'+new URLSearchParams({state,challenge,returnOrigin:desktop?'irmrmsdesktop://auth':location.origin});
 if(desktop)await desktop.core.invoke('plugin:opener|open_url',{url:target});else location.assign(target);
}
export async function finishLogin({storage=sessionStorage,location=window.location,history=window.history,fetchImpl=fetch}={}){
 const params=new URLSearchParams(location.hash.slice(1));if(!params.has('irm_login_code'))return null;
 const raw=storage.getItem(KEY);history.replaceState(null,'',location.pathname+location.search);
 let pending;try{pending=JSON.parse(raw)}catch{}
 if(!pending||pending.state!==params.get('state')||!Number.isFinite(pending.createdAt)||Date.now()-pending.createdAt<0||Date.now()-pending.createdAt>5*60000)throw Error('Login expired or state did not match');
 storage.removeItem(KEY);
 const api=new URL(pending.baseUrl);if(api.origin!==pending.baseUrl||api.protocol!=='https:')throw Error('Invalid login origin');
 const response=await fetchImpl(pending.baseUrl+'/auth/exchange',{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({state:pending.state,verifier:pending.verifier,code:params.get('irm_login_code')})});
 const body=await response.json();if(!response.ok)throw Error(body.error||'Login failed');
 if(typeof body.accessToken!=='string'||!body.accessToken.startsWith('irm_session_'))throw Error('Invalid login response');
 return {baseUrl:pending.baseUrl,accessToken:body.accessToken};
}

export async function bindDesktopLogin(onSession,onError,{desktop=window.__TAURI__}={}){
 if(!desktop)return ()=>{};let running=false;
 async function receive(urls){
  for(const value of Array.isArray(urls)?urls:[]){
   let callback;try{callback=new URL(value)}catch{continue}
   if(callback.protocol!=='irmrmsdesktop:'||callback.host!=='auth'||callback.pathname||callback.search||callback.username||callback.password||value.length>4096)continue;
   if(running)return;running=true;
   try{const result=await finishLogin({location:callback,history:{replaceState(){}}});if(result)await onSession(result)}catch(error){onError(error)}finally{running=false}
  }
 }
 const unlisten=await desktop.event.listen('deep-link://new-url',event=>receive(event.payload));
 await receive(await desktop.core.invoke('plugin:deep-link|get_current'));
 return unlisten;
}
