import {can} from '../packages/security/permissions.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export const CHECKS=['identity','zebra','offline','windows','signing','restore','vendor-contract','security'];
export function validateAccount(x,principal){
 if(!x||!/^demo-user-[a-z0-9-]{1,40}$/.test(x.id)||!['viewer','warehouse','dispatcher'].includes(x.role))throw Error('Synthetic user ID and non-administrative role required');
 if(!Array.isArray(x.customerIds)||!x.customerIds.length||x.customerIds.length>4||new Set(x.customerIds).size!==x.customerIds.length||x.customerIds.some(id=>!['c1','c2','c3','c4'].includes(id)||!principal.customerIds.includes(id)))throw Error('Explicit granted synthetic customers required');
 return {id:x.id,role:x.role,customerIds:x.customerIds};
}
export async function administrationRoute(request,env,principal,readBody){
 const u=new URL(request.url),local=['localhost','127.0.0.1'].includes(u.hostname);
 if(!local||principal.id==='demo-api-user')return json({error:'Verified local account required'},403);
 if(request.method==='POST'&&env.SYNTHETIC_MANAGEMENT_ENABLED!=='true')return json({error:'Local management is disabled'},403);
 if(u.pathname==='/v1/administration/users'){
  if(!can(principal,'users:manage'))return json({error:'Forbidden'},403);
  if(request.method==='GET'){
   const rows=(await env.DB.prepare("SELECT id,role,active,admin_version FROM app_users WHERE external_subject LIKE 'synthetic:%' ORDER BY id LIMIT 101").all()).results||[];
   const items=[];for(const row of rows){const grants=(await env.DB.prepare('SELECT customer_id FROM user_customer_access WHERE user_id=?').bind(row.id).all()).results||[];if(grants.every(g=>principal.customerIds.includes(g.customer_id)))items.push({...row,customerIds:grants.map(g=>g.customer_id)})}
   return json({items:items.slice(0,100),limited:rows.length>100});
  }
  if(request.method==='POST'){
   let x;try{x=validateAccount(await readBody(request),principal)}catch(e){return json({error:e.message},400)}
   try{await env.DB.batch([env.DB.prepare('INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES(?,?,?,?,0)').bind(x.id,'synthetic:'+x.id,x.id,x.role),...x.customerIds.map(id=>env.DB.prepare('INSERT INTO user_customer_access(user_id,customer_id) VALUES(?,?)').bind(x.id,id))])}catch{return json({error:'Account exists or could not be provisioned atomically'},409)}
   return json({...x,active:false,admin_version:0},201);
  }
 }
 if(u.pathname==='/v1/administration/account-state'&&request.method==='POST'){
  if(!can(principal,'users:manage'))return json({error:'Forbidden'},403);
  let x;try{x=await readBody(request)}catch{return json({error:'Invalid request'},400)}
  if(!x||typeof x.active!=='boolean'||!Number.isInteger(x.expectedVersion)||x.expectedVersion<0||x.id===principal.id||!/^demo-user-[a-z0-9-]{1,40}$/.test(x.id))return json({error:'Invalid synthetic account state'},400);
  const grants=(await env.DB.prepare('SELECT customer_id FROM user_customer_access WHERE user_id=?').bind(x.id).all()).results||[];
  if(!grants.length||grants.some(g=>!principal.customerIds.includes(g.customer_id)))return json({error:'Forbidden'},403);
  const result=await env.DB.prepare("UPDATE app_users SET active=?,admin_version=admin_version+1 WHERE id=? AND external_subject=? AND admin_version=? AND role IN ('viewer','warehouse','dispatcher')").bind(x.active?1:0,x.id,'synthetic:'+x.id,x.expectedVersion).run();
  return result.meta?.changes===1?json({updated:true}):json({error:'Account changed; refresh first'},409);
 }
 if(u.pathname==='/v1/administration/acceptance'){
  const customerId=u.searchParams.get('customerId');if(!can(principal,'audit:read',{customerId}))return json({error:'Forbidden'},403);
  if(request.method==='GET')return json({productionReady:false,supervisedPilotReady:false,checks:CHECKS,items:(await env.DB.prepare('SELECT * FROM acceptance_observations WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(customerId).all()).results||[]});
  if(request.method==='POST'){
   let x;try{x=await readBody(request)}catch{return json({error:'Invalid request'},400)}
   if(!x||!CHECKS.includes(x.check)||!['pass','fail','blocked'].includes(x.outcome)||!/^demo-evidence:[a-zA-Z0-9._/-]{1,160}$/.test(x.reference)||!(/^[a-f0-9]{40}$/).test(x.commit))return json({error:'Check, outcome, synthetic evidence reference and full source commit required'},400);
   const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO acceptance_observations(id,actor_id,customer_id,check_name,outcome,reference,source_commit) VALUES(?,?,?,?,?,?,?)').bind(id,principal.id,customerId,x.check,x.outcome,x.reference,x.commit).run();return json({id,observationOnly:true,productionReady:false},201);
  }
 }
 return json({error:'Not found'},404);
}
