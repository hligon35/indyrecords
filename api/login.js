import {verifyIdentity,loadPrincipal,digest} from './auth.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer'}});
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(value);
export async function pkceChallenge(verifier){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export async function loginRoute(request,env,readBody){
 if(env.ACCESS_LOGIN_ENABLED!=='true')return {response:json({error:'Interactive login is not configured'},503)};
 const url=new URL(request.url);
 if(url.pathname==='/auth/login'&&request.method==='GET'){
  const state=url.searchParams.get('state'),challenge=url.searchParams.get('challenge'),returnOrigin=url.searchParams.get('returnOrigin');
  const allowed=(env.READONLY_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim());
  const native=['irmrmsdemo://auth','irmrmsdesktop://auth'].includes(returnOrigin)&&(env.NATIVE_LOGIN_REDIRECTS||'').split(',').map(x=>x.trim()).includes(returnOrigin);
  let target;try{target=new URL(returnOrigin)}catch{}
  if(!valid(state)||!valid(challenge)||challenge.length!==43||!target||(!native&&(target.origin!==returnOrigin||!allowed.includes(returnOrigin)||!(target.protocol==='https:'||(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname))))))return {response:json({error:'Invalid login request'},400)};
  // Protect this route with Cloudflare Access. The edge performs interactive login;
  // this Worker independently validates its signed assertion before issuing a code.
  let claims;try{claims=await verifyIdentity(request.headers.get('cf-access-jwt-assertion'),env)}catch{return {response:json({error:'An Access-protected login route is required'},401)}}
  const principal=await loadPrincipal(env.DB,claims.sub);
  if(!principal)return {response:json({error:'User is not approved'},403)};
  const code=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
  const expiresAt=Math.min(Date.now()+60000,claims.exp*1000);
  await env.DB.prepare('INSERT INTO login_attempts(state_hash,challenge,return_origin,expires_at,code_hash,user_id,identity_expires_at) VALUES(?,?,?,?,?,?,?)').bind(await digest(state),challenge,returnOrigin,expiresAt,await digest(code),principal.id,claims.exp*1000).run();
  const response=new Response(null,{status:302,headers:{location:returnOrigin+(native?'#':'/#')+new URLSearchParams({irm_login_code:code,state}), 'cache-control':'no-store','referrer-policy':'no-referrer'}});
  return {response,principal};
 }
 if(url.pathname==='/auth/exchange'&&request.method==='POST'){
  let body;try{body=await readBody(request)}catch{return {response:json({error:'Invalid login exchange'},400)}}
  const {state,code,verifier}=body||{};
  if(!valid(state)||!valid(code)||!valid(verifier))return {response:json({error:'Invalid login exchange'},400)};
  const codeHash=await digest(code),stateHash=await digest(state);
  const attempt=await env.DB.prepare('SELECT * FROM login_attempts WHERE code_hash=? AND state_hash=? AND consumed_at IS NULL AND expires_at>?').bind(codeHash,stateHash,Date.now()).first();
  const origin=request.headers.get('origin');
  const nativeAttempt=attempt&&['irmrmsdemo://auth','irmrmsdesktop://auth'].includes(attempt.return_origin);
  const originAllowed=!origin||origin===attempt?.return_origin||(nativeAttempt&&['http://tauri.localhost','tauri://localhost'].includes(origin)&&(env.READONLY_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).includes(origin));
  if(!attempt||attempt.challenge!==await pkceChallenge(verifier)||!originAllowed)return {response:json({error:'Login expired or invalid'},401)};
  const principal=await loadPrincipal(env.DB,attempt.user_id,{byId:true});
  if(!principal)return {response:json({error:'User is not approved'},403)};
  const consumed=await env.DB.prepare('UPDATE login_attempts SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING user_id').bind(Date.now(),codeHash,Date.now()).first();
  if(!consumed)return {response:json({error:'Login code already consumed'},401)};
  const accessToken='irm_session_'+crypto.randomUUID()+crypto.randomUUID(),expiresAt=Math.min(Date.now()+15*60000,attempt.identity_expires_at);
  await env.DB.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(accessToken),principal.id,expiresAt).run();
  return {principal,response:json({accessToken,expiresAt,user:{id:principal.id,role:principal.role}},201)};
 }
 return {response:json({error:'Not found'},404)};
}
