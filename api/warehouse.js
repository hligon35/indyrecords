import {can} from '../packages/security/permissions.js';
import {seedWarehouse,applyWarehouseCommand,COMMAND_PERMISSIONS} from '../packages/warehouse/workflows.js';
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const view=state=>{const {receipts,...publicState}=state;return publicState};
export async function warehouseRoute(request,env,principal,readBody){
 const url=new URL(request.url);
 // Separate local sandbox only. Neither operational records nor public mutations are supported.
 if(env.SYNTHETIC_WORKFLOWS_ENABLED!=='true'||!['localhost','127.0.0.1'].includes(url.hostname)||principal.id==='demo-api-user')return response({error:'Verified local synthetic workspace required'},403);
 let customerId=url.searchParams.get('customerId'),command;
 if(request.method==='POST'){
  let body;try{body=await readBody(request)}catch(error){return response({error:'Invalid command payload'},error.status===413?413:400)}
  if(!body||typeof body!=='object'||Array.isArray(body))return response({error:'Invalid command payload'},400);
  ({customerId,command}=body);
 }
 if(!['c1','c2','c3','c4'].includes(customerId))return response({error:'Synthetic customer required'},400);
 const permission=request.method==='GET'?'orders:read':Object.hasOwn(COMMAND_PERMISSIONS,command?.type)?COMMAND_PERMISSIONS[command.type]:null;
 if(!permission||!can(principal,permission,{customerId}))return response({error:'Forbidden'},403);
 if(url.pathname==='/v1/sandbox/workspace'&&request.method==='GET'){
  const row=await env.DB.prepare('SELECT payload FROM sandbox_workspaces WHERE customer_id=?').bind(customerId).first();
  return response(view(row?JSON.parse(row.payload):seedWarehouse(customerId)));
 }
 if(url.pathname!=='/v1/sandbox/commands'||request.method!=='POST')return response({error:'Not found'},404);
 if(['create_order','register_record'].includes(command.type)){const customer=await env.DB.prepare('SELECT active FROM customer_profiles WHERE customer_id=?').bind(customerId).first();if(customer?.active===0)return response({error:'Customer profile is archived; new intake/orders are disabled'},409)}
 const seed=seedWarehouse(customerId);
 await env.DB.prepare('INSERT OR IGNORE INTO sandbox_workspaces(customer_id,payload) VALUES(?,?)').bind(customerId,JSON.stringify(seed)).run();
 for(let attempt=0;attempt<3;attempt++){
  const row=await env.DB.prepare('SELECT version,payload FROM sandbox_workspaces WHERE customer_id=?').bind(customerId).first();
  let result;try{result=await applyWarehouseCommand(JSON.parse(row.payload),command,principal.id)}catch(error){return response({error:error.message},error.status||400)}
  if(result.status==='already_accepted')return response({status:result.status,workspace:view(result.state)});
  const saved=await env.DB.prepare('UPDATE sandbox_workspaces SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?').bind(JSON.stringify(result.state),customerId,row.version).run();
  if(saved.meta?.changes===1)return response({status:'accepted',workspace:view(result.state)},201);
 }
 return response({error:'Workspace changed concurrently; refresh and retry'},409);
}
