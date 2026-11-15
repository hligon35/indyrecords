// One short-lived account session shared by inventory and driver screens. No tokens in URLs/queues.
export function createSessionController({storage,verify,revoke,onLock=()=>{},now=Date.now}){
 const KEY='irm-rms-short-session';let value=null,epoch=0,listeners=new Set(),tail=Promise.resolve();
 const notify=()=>{for(const listener of listeners)listener(value)};
 const serialize=work=>{const next=tail.then(work,work);tail=next.catch(()=>{});return next};
 function validate(s){if(!s||typeof s.accessToken!=='string'||!s.accessToken.startsWith('irm_session_')||!Number.isFinite(s.expiresAt)||s.expiresAt<=now())throw Error('Session expired');const u=new URL(s.baseUrl);if(u.protocol!=='https:'||u.origin!==s.baseUrl)throw Error('Approved HTTPS API origin required')}
 async function setSession(candidate){
  const ticket=++epoch;validate(candidate);const identity=await verify(candidate);
  if(!identity?.user?.id||!Array.isArray(identity.customerIds))throw Error('Invalid verified identity');
  const expiresAt=Math.min(candidate.expiresAt,Number.isFinite(identity.expiresAt)?identity.expiresAt:now()+15*60000,now()+15*60000);if(expiresAt<=now())throw Error('Verified session expired');
  const credential={baseUrl:candidate.baseUrl,accessToken:candidate.accessToken,expiresAt},identityCache={user:identity.user,customerIds:identity.customerIds,verifiedAt:now()},next={...credential,...identityCache,offline:false};
  return serialize(async()=>{if(ticket!==epoch)throw Error('Account changed during sign in');await storage.setItem(KEY,JSON.stringify({...credential,identityCache}));if(ticket!==epoch){await storage.deleteItem(KEY);throw Error('Account changed during sign in')}onLock();value=next;notify();return value});
 }
 async function clear({remote=false}={}){
  const old=value;epoch++;value=null;onLock();notify();
  let failure;try{await serialize(()=>storage.deleteItem(KEY))}catch(e){failure=e}
  if(remote&&old)try{await revoke(old)}catch(e){failure??=e}
  if(failure)throw failure;
 }
 return {
  get current(){if(value&&value.expiresAt<=now()){epoch++;value=null;onLock();notify();serialize(()=>storage.deleteItem(KEY)).catch(()=>{})}return value},
  get revision(){return epoch},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  setSession,clear,
  async restore(){const ticket=epoch,raw=await storage.getItem(KEY);if(!raw||ticket!==epoch)return null;let candidate;try{candidate=JSON.parse(raw);validate(candidate);return await setSession(candidate)}catch(e){
   const cache=candidate?.identityCache,network=e instanceof TypeError||e.status>=500;
   if(network&&epoch===ticket+1&&cache?.user?.id&&['viewer','warehouse','dispatcher','manager','admin'].includes(cache.user.role)&&Array.isArray(cache.customerIds)&&cache.customerIds.every(id=>typeof id==='string')&&Number.isFinite(cache.verifiedAt)&&cache.verifiedAt<=now()&&candidate.expiresAt<=cache.verifiedAt+15*60000&&candidate.expiresAt>now()){
    return serialize(async()=>{if(epoch!==ticket+1)return null;onLock();value={baseUrl:candidate.baseUrl,accessToken:candidate.accessToken,expiresAt:candidate.expiresAt,...cache,offline:true};notify();return value});
   }
   if(ticket===epoch||ticket+1===epoch)await clear();return null
  }},
  async verifyCurrent(){const current=value;if(!current||current.expiresAt<=now()){await clear();throw Error('Sign in required')}const ticket=epoch;try{const verified=await verify(current);if(ticket!==epoch)throw Error('Account changed');if(!verified?.user?.id||!Array.isArray(verified.customerIds))throw Error('Invalid verified identity');const expiresAt=Math.min(current.expiresAt,Number.isFinite(verified.expiresAt)?verified.expiresAt:current.expiresAt);if(expiresAt<=now())throw Object.assign(Error('Verified session expired'),{status:401});if(JSON.stringify([current.user,current.customerIds,current.expiresAt])!==JSON.stringify([verified.user,verified.customerIds,expiresAt]))onLock();value={...current,expiresAt,user:verified.user,customerIds:verified.customerIds,verifiedAt:now(),offline:false};notify();await serialize(async()=>{if(ticket!==epoch)return;await storage.setItem(KEY,JSON.stringify({baseUrl:current.baseUrl,accessToken:current.accessToken,expiresAt,identityCache:{user:verified.user,customerIds:verified.customerIds,verifiedAt:now()}}))});if(ticket!==epoch)throw Error('Account changed');return value}catch(e){if(ticket===epoch&&[401,403].includes(e.status))await clear();throw e}}
 };
}
