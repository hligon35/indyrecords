// Cloudflare Access application tokens; never trust identity or role headers alone.
const encoder=new TextEncoder();
const keys=new Map();
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function verifyIdentity(token,env,fetchImpl=fetch){
 const issuer=env.ACCESS_ISSUER;
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'')||!env.ACCESS_AUDIENCE)throw Error('Identity provider not configured');
 if(typeof token!=='string'||token.length>16384)throw Error('Invalid token');
 const parts=token.split('.');if(parts.length!==3)throw Error('Invalid token');
 const header=JSON.parse(new TextDecoder().decode(bytes(parts[0])));
 const claims=JSON.parse(new TextDecoder().decode(bytes(parts[1])));
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit||claims.iss!==issuer||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUDIENCE)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now))||typeof claims.sub!=='string'||!claims.sub)throw Error('Invalid claims');
 let cached=keys.get(issuer);
 if(!cached||cached.until<Date.now()||!cached.keys.some(k=>k.kid===header.kid)){
  const response=await fetchImpl(issuer+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Signing keys unavailable');
  const jwks=await response.json();if(!Array.isArray(jwks.keys))throw Error('Invalid signing keys');
  cached={keys:jwks.keys,until:Date.now()+300000};keys.set(issuer,cached);
 }
 const jwk=cached.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
 if(!jwk)throw Error('Unknown signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))throw Error('Invalid signature');
 return claims;
}
export async function digest(token){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function loadPrincipal(DB,subject,{byId=false}={}){
 const user=await DB.prepare('SELECT id,role,active FROM app_users WHERE '+(byId?'id':'external_subject')+'=?').bind(subject).first();
 if(!user||user.active!==1)return null;
 const grants=await DB.prepare('SELECT customer_id FROM user_customer_access WHERE user_id=?').bind(user.id).all();
 return {...user,active:true,customerIds:(grants.results||[]).map(x=>x.customer_id)};
}
export async function authenticate(request,env){
 const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
 if(!token||token.length>16384)return null;
 if(token.startsWith('irm_session_')){
  const session=await env.DB.prepare('SELECT user_id FROM app_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await digest(token),Date.now()).first();
  return session?loadPrincipal(env.DB,session.user_id,{byId:true}):null;
 }
 const claims=await verifyIdentity(token,env);
 return loadPrincipal(env.DB,claims.sub);
}
