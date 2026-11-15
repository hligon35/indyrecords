import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{handler} from '../api/worker.js';
import {verifyIdentity,digest} from '../api/auth.js';

const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
const issuer='https://irm-test.cloudflareaccess.com';
const config={ACCESS_ISSUER:issuer,ACCESS_AUDIENCE:'test-audience'};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function jwt(overrides={},header={}){
 const now=Math.floor(Date.now()/1000);
 const data=encode({alg:'RS256',kid:'test-key',...header})+'.'+encode({iss:issuer,aud:['test-audience'],sub:'subject-1',iat:now,exp:now+600,...overrides});
 return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data))).toString('base64url');
}
const keyFetch=async()=>new Response(JSON.stringify({keys:[jwk]}));
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['migrations/0001_initial.sql','migrations/0002_auth_audit_foundation.sql','migrations/0003_sessions.sql','migrations/0004_synthetic_workflows.sql','migrations/0005_management_integration_security.sql','migrations/0006_synthetic_administration.sql','migrations/0007_synthetic_commercial.sql','migrations/0008_synthetic_field.sql','scripts/seed-demo.sql'])db.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES('u1','subject-1','Synthetic User','viewer',1); INSERT INTO user_customer_access VALUES('u1','c2');");
 const DB={prepare(sql){let params=[];const query={bind(...values){params=values;return query},async first(){return db.prepare(sql).get(...params)||null},async all(){return {results:db.prepare(sql).all(...params)}},async run(){const result=db.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}}}};return query}};
 return {db,env:{...config,DB}};
}
function request(path,token,method='GET'){return new Request('https://private.example'+path,{method,headers:{authorization:'Bearer '+token}})}
test('signed identity requires signature, issuer, audience, expiry and algorithm',async()=>{
 assert.equal((await verifyIdentity(await jwt(),config,keyFetch)).sub,'subject-1');
 for(const claims of [{iss:'https://evil.test'},{aud:['other']},{exp:0},{iat:1e12},{nbf:1e12},{sub:''}])await assert.rejects(verifyIdentity(await jwt(claims),config,keyFetch));
 await assert.rejects(verifyIdentity(await jwt({}, {alg:'none'}),config,keyFetch));
 const token=await jwt();const parts=token.split('.');parts[1]=encode({sub:'attacker'});await assert.rejects(verifyIdentity(parts.join('.'),config,keyFetch));
 const validParts=token.split('.');validParts[2]=(validParts[2][0]==='A'?'B':'A')+validParts[2].slice(1);await assert.rejects(verifyIdentity(validParts.join('.'),config,keyFetch));
});
test('SQL-backed sessions enforce customer scope, revocation and live role changes',async()=>{
 const {db,env}=fixture();const originalFetch=globalThis.fetch;globalThis.fetch=keyFetch;
 try{
  const login=await handler(request('/v1/session',await jwt(),'POST'),env);assert.equal(login.status,201);
  const {accessToken}=await login.json();assert.ok(accessToken.startsWith('irm_session_'));
  assert.equal(db.prepare('SELECT token_hash FROM app_sessions').get().token_hash,await digest(accessToken));
  const inventory=await (await handler(request('/v1/records',accessToken),env)).json();assert.deepEqual(inventory.items.map(x=>x.barcode),['IRM-BX-1002']);
  assert.equal((await handler(request('/v1/records/IRM-BX-1003',accessToken),env)).status,404);
  const summary=await (await handler(request('/v1/reports/summary',accessToken),env)).json();assert.equal(summary.inventory[0].total,1);
  assert.equal((await handler(request('/v1/scans',accessToken,'POST'),env)).status,403);
  db.exec("DELETE FROM user_customer_access WHERE user_id='u1'");
  assert.deepEqual((await (await handler(request('/v1/records',accessToken),env)).json()).items,[]);
  db.exec("UPDATE app_users SET active=0");assert.equal((await handler(request('/v1/session',accessToken),env)).status,401);
  db.exec("UPDATE app_users SET active=1");assert.equal((await handler(request('/v1/session',accessToken,'DELETE'),env)).status,200);
  assert.equal((await handler(request('/v1/records',accessToken),env)).status,401);
  const audits=db.prepare('SELECT * FROM access_audit').all();assert.ok(audits.some(x=>x.decision==='deny'));assert.ok(audits.some(x=>x.actor_id==='u1'&&x.decision==='allow'));assert.ok(!JSON.stringify(audits).includes(accessToken));
 }finally{globalThis.fetch=originalFetch;db.close()}
});
test('expired sessions and unprovisioned users fail closed; audit failure withholds data',async()=>{
 const {db,env}=fixture();const originalFetch=globalThis.fetch;globalThis.fetch=keyFetch;
 try{
  assert.equal((await handler(request('/v1/records',await jwt({sub:'unknown'})),env)).status,401);
  const token='irm_session_expired';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()-1);
  assert.equal((await handler(request('/v1/records',token),env)).status,401);
  db.exec('DROP TABLE access_audit');assert.equal((await handler(request('/v1/records',await jwt()),env)).status,503);
 }finally{globalThis.fetch=originalFetch;db.close()}
});

test('CORS allows only exact approved origins, including preflight',async()=>{
 const {db,env}=fixture();env.READONLY_ALLOWED_ORIGINS='http://tauri.localhost,http://127.0.0.1:4173';
 try{
  for(const origin of ['http://tauri.localhost','http://127.0.0.1:4173']){
   const response=await worker.fetch(new Request('https://private.example/v1/records',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET'}}),env);
   assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),null);
  }
  const denied=await worker.fetch(new Request('https://private.example/v1/records',{headers:{origin:'https://evil.example'}}),env);
  assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  assert.equal(db.prepare('SELECT decision FROM access_audit').get().decision,'deny');
 }finally{db.close()}
});
test('local verified scan writes enforce roles, customer grants and idempotent payloads',async()=>{
 const {db,env}=fixture();env.DEMO_WRITES_ENABLED='true';const originalFetch=globalThis.fetch;globalThis.fetch=keyFetch;
 try{
  const token=await jwt();const body={clientEventId:'scoped-1',barcode:'IRM-BX-1002',operation:'Box Retrieval',mode:'outbound',occurredAt:new Date().toISOString()};
  const scan=(changes={},origin='http://localhost')=>new Request(origin+'/v1/scans',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({...body,...changes})});
  assert.equal((await handler(scan(),env)).status,403);db.exec("UPDATE app_users SET role='warehouse'");
  assert.equal((await handler(scan({barcode:'IRM-BX-1003'}),env)).status,404);
  assert.equal((await handler(scan(),env)).status,201);assert.equal((await (await handler(scan(),env)).json()).status,'already_accepted');
  assert.equal((await handler(scan({operation:'Box Withdrawal'}),env)).status,409);
  assert.equal((await handler(scan({},'https://private.example'),env)).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scan_events').get().n,1);
  assert.equal(db.prepare('SELECT actor_id FROM scan_events').get().actor_id,'u1');
  const oversized=new Request('http://localhost/v1/scans',{method:'POST',headers:{authorization:'Bearer '+token},body:'x'.repeat(5000)});
  assert.equal((await handler(oversized,env)).status,413);
 }finally{globalThis.fetch=originalFetch;db.close()}
});

test('interactive login verifies Access identity, binds PKCE and consumes the code exactly once',async()=>{
 const {db,env}=fixture();env.ACCESS_LOGIN_ENABLED='true';env.READONLY_ALLOWED_ORIGINS='https://app.example';const originalFetch=globalThis.fetch;globalThis.fetch=keyFetch;
 try{
  const {pkceChallenge}=await import('../api/login.js');const state='s'.repeat(64),verifier='v'.repeat(64);
  const url='https://private.example/auth/login?'+new URLSearchParams({state,challenge:await pkceChallenge(verifier),returnOrigin:'https://app.example'});
  const login=await handler(new Request(url,{headers:{'cf-access-jwt-assertion':await jwt()}}),env);assert.equal(login.status,302);
  const fragment=new URLSearchParams(new URL(login.headers.get('location')).hash.slice(1));const code=fragment.get('irm_login_code');
  const exchange=(v=verifier)=>new Request('https://private.example/auth/exchange',{method:'POST',headers:{origin:'https://app.example','content-type':'application/json'},body:JSON.stringify({state,code,verifier:v})});
  assert.equal((await handler(exchange('wrong'.repeat(16)),env)).status,401);
  const response=await handler(exchange(),env);assert.equal(response.status,201);const {accessToken}=await response.json();
  assert.equal((await handler(request('/v1/session',accessToken),env)).status,200);assert.equal((await handler(exchange(),env)).status,401);
  assert.equal((await handler(new Request(url.replace('https%3A%2F%2Fapp.example','https%3A%2F%2Fevil.example')),env)).status,400);
 }finally{globalThis.fetch=originalFetch;db.close()}
});
test('synthetic D1 warehouse commands enforce tenant/role isolation and leave source records unchanged',async()=>{
 const {db,env}=fixture();env.SYNTHETIC_WORKFLOWS_ENABLED='true';const token='irm_session_warehouse';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+60000);
 const command={type:'create_order',clientEventId:'order-command-1',orderId:'demo-order',operation:'Retrieval',barcodes:['IRM-BX-1002']};
 const send=(cmd=command,customerId='c2',host='http://localhost')=>handler(new Request(host+'/v1/sandbox/commands',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({customerId,command:cmd})}),env);
 try{
  assert.equal((await send()).status,403);assert.equal((await handler(new Request('http://localhost/v1/sandbox/workspace?customerId=c2',{headers:{authorization:'Bearer '+token}}),env)).status,403);db.exec("UPDATE app_users SET role='manager'");
  assert.equal((await send(command,'c3')).status,403);assert.equal((await send(command,'c2','https://public.example')).status,403);
  assert.equal((await send()).status,201);assert.equal((await (await send()).json()).status,'already_accepted');
  const pick={type:'pick',clientEventId:'pick-1',orderId:'demo-order',orderVersion:0,barcode:'IRM-BX-1002',expectedVersion:1};
  assert.equal((await send(pick)).status,201);assert.equal((await send({...pick,clientEventId:'stale-1'})).status,409);
  const state=JSON.parse(db.prepare('SELECT payload FROM sandbox_workspaces').get().payload);assert.equal(state.records[0].status,'Picked');assert.equal(state.custody.length,2);
  assert.equal(db.prepare("SELECT status FROM records WHERE barcode='IRM-BX-1002'").get().status,'Stored');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scan_events').get().n,0);
  const view=await handler(new Request('http://localhost/v1/sandbox/workspace?customerId=c2',{headers:{authorization:'Bearer '+token}}),env);assert.equal(view.status,200);assert.equal((await view.json()).receipts,undefined);
 }finally{db.close()}
});

test('concurrent warehouse updates use compare-and-swap and persist one custody event',async()=>{
 const {db,env}=fixture();env.SYNTHETIC_WORKFLOWS_ENABLED='true';db.exec("UPDATE app_users SET role='warehouse'");const token='irm_session_concurrent';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+60000);
 const move=(clientEventId,location)=>handler(new Request('http://localhost/v1/sandbox/commands',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({customerId:'c2',command:{type:'move',clientEventId,barcode:'IRM-BX-1002',expectedVersion:0,location}})}),env);
 try{const responses=await Promise.all([move('race-1','A01-R02'),move('race-2','A02-R01')]);assert.deepEqual(responses.map(x=>x.status).sort(),[201,409]);const row=db.prepare('SELECT version,payload FROM sandbox_workspaces').get();assert.equal(row.version,1);assert.equal(JSON.parse(row.payload).custody.length,1)}finally{db.close()}
});

test('customer management enforces scope, optimistic versions and archived intake rules',async()=>{
 const {db,env}=fixture();env.SYNTHETIC_MANAGEMENT_ENABLED='true';env.SYNTHETIC_WORKFLOWS_ENABLED='true';const token='irm_session_management';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+60000);
 const send=(path,body,host='http://localhost')=>handler(new Request(host+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);
 try{
  assert.equal((await send('/v1/management/customers')).status,403);db.exec("UPDATE app_users SET role='manager'");
  const list=await (await send('/v1/management/customers')).json();assert.deepEqual(list.items.map(x=>x.customerId),['c2']);
  const profile={customerId:'c2',displayName:'Synthetic office',contactAlias:'demo-office',active:false,expectedVersion:0};
  assert.equal((await send('/v1/management/customers',{...profile,customerId:'c3'})).status,403);
  assert.equal((await send('/v1/management/customers',profile,'https://private.example')).status,403);
  assert.equal((await send('/v1/management/customers',profile)).status,200);assert.equal((await send('/v1/management/customers',profile)).status,409);
  const command={type:'create_order',clientEventId:'archived-order',orderId:'demo-archived',operation:'Retrieval',barcodes:['IRM-BX-1002']};
  assert.equal((await send('/v1/sandbox/commands',{customerId:'c2',command})).status,409);
  assert.equal(db.prepare("SELECT name FROM customers WHERE id='c2'").get().name,'Sample Legal');
 }finally{db.close()}
});
test('report endpoints enforce customer scope, report roles and binary export audit persistence',async()=>{
 const {db,env}=fixture();const token='irm_session_reports';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+60000);
 const get=path=>handler(new Request('http://localhost'+path,{headers:{authorization:'Bearer '+token}}),env);
 try{
  const base='/v1/management/report?source=inventory&customerId=c2';const report=await (await get(base)).json();assert.equal(report.rows.length,1);assert.equal(report.rows[0].barcode,'IRM-BX-1002');
  assert.equal((await get(base.replace('c2','c3'))).status,403);assert.equal((await get(base+'&type=custody')).status,403);assert.equal((await get(base+'&type=orders')).status,403);
  assert.equal((await (await get(base+'&q=1002')).json()).rows.length,1);assert.equal((await (await get(base+'&q=%25')).json()).rows.length,0);
  const pdf=await get(base+'&format=pdf');assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0,5)),'%PDF-');
  const csv=await get(base+'&format=csv');assert.match(await csv.text(),/IRM-BX-1002/);
  db.exec('DROP TABLE access_audit');assert.equal((await get(base+'&format=pdf')).status,503);
 }finally{db.close()}
});
test('synthetic adapters persist provenance and reconciliation without changing source tables',async()=>{
 const {db,env}=fixture();env.SYNTHETIC_MANAGEMENT_ENABLED='true';const token='irm_session_adapter';db.exec("UPDATE app_users SET role='manager'");db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+60000);
 const {CONTRACTS}=await import('../packages/integrations/adapters.js');
 const body={source:'andrew',schemaVersion:CONTRACTS.andrew.version,customerId:'c2',filename:'demo-andrew.csv',sourceTimestamp:new Date().toISOString(),csv:CONTRACTS.andrew.columns.join(',')+'\n'+['demo-1','IRM-BX-1002','c2','Sample Legal','A01-R02','Stored',new Date().toISOString()].join(',')};
 const post=input=>handler(new Request('http://localhost/v1/management/integrations',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)}),env);
 try{
  assert.equal((await post({...body,customerId:'c3'})).status,403);
  const response=await post(body);assert.equal(response.status,201);const job=await response.json();assert.equal(job.reconciliation.matched,1);assert.equal(job.accepted.length,1);assert.match(job.sourceHash,/^[a-f0-9]{64}$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integration_jobs').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n,4);
  const history=await handler(new Request('http://localhost/v1/management/integrations?customerId=c2',{headers:{authorization:'Bearer '+token}}),env);assert.equal((await history.json()).items.length,1);
 }finally{db.close()}
});
test('authentication throttling is persistent, returns retry timing and remains audited',async()=>{
 const {db,env}=fixture();env.ACCESS_LOGIN_ENABLED='true';
 try{let last;for(let i=0;i<11;i++)last=await handler(new Request('https://private.example/auth/exchange',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.99'},body:'{}'}),env);assert.equal(last.status,429);assert.ok(Number(last.headers.get('retry-after'))>0);assert.equal(db.prepare('SELECT attempts FROM auth_rate_limits').get().attempts,11);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_audit').get().n,11)}finally{db.close()}
});

test('native callbacks require an explicit approved scheme and retain PKCE protection',async()=>{
 const {db,env}=fixture();env.ACCESS_LOGIN_ENABLED='true';env.NATIVE_LOGIN_REDIRECTS='irmrmsdesktop://auth,irmrmsdemo://auth';env.READONLY_ALLOWED_ORIGINS='http://tauri.localhost';const old=globalThis.fetch;globalThis.fetch=keyFetch;
 try{const {pkceChallenge}=await import('../api/login.js');for(const [i,redirect] of ['irmrmsdesktop://auth','irmrmsdemo://auth'].entries()){
  const state=String(i+1).repeat(64),verifier='f'.repeat(64),url='https://private.example/auth/login?'+new URLSearchParams({state,challenge:await pkceChallenge(verifier),returnOrigin:redirect});
  const login=await handler(new Request(url,{headers:{'cf-access-jwt-assertion':await jwt()}}),env);assert.equal(login.status,302);const code=new URLSearchParams(new URL(login.headers.get('location')).hash.slice(1)).get('irm_login_code');
  const exchange=await handler(new Request('https://private.example/auth/exchange',{method:'POST',headers:{'content-type':'application/json',...(i===0?{origin:'http://tauri.localhost'}:{})},body:JSON.stringify({state,code,verifier})}),env);assert.equal(exchange.status,201);
 }}finally{globalThis.fetch=old;db.close()}
});

test('pilot observation API uses verified sessions and persists access audit before release',async()=>{const {db,env}=fixture();const original=globalThis.fetch;globalThis.fetch=keyFetch;try{db.exec("UPDATE app_users SET role='manager' WHERE id='u1'");env.SYNTHETIC_MANAGEMENT_ENABLED='true';const issued=await handler(request('/v1/session',await jwt(),'POST'),env);const {accessToken}=await issued.json();const response=await handler(new Request('http://localhost/v1/administration/acceptance?customerId=c2',{method:'POST',headers:{authorization:'Bearer '+accessToken},body:JSON.stringify({check:'offline',outcome:'blocked',reference:'demo-evidence:device/pending',commit:'a'.repeat(40)})}),env);assert.equal(response.status,201);const audit=db.prepare('SELECT decision FROM access_audit WHERE id=?').get(response.headers.get('x-request-id'));assert.equal(audit.decision,'allow');assert.equal(db.prepare('SELECT COUNT(*) n FROM acceptance_observations').get().n,1);db.exec('DROP TABLE access_audit');const hidden=await handler(new Request('http://localhost/v1/administration/acceptance?customerId=c2',{headers:{authorization:'Bearer '+accessToken}}),env);assert.equal(hidden.status,503)}finally{globalThis.fetch=original;db.close()}});

test('commercial API persists scoped versioned commands, enforces local flags and audits access',async()=>{const {db,env}=fixture();const old=globalThis.fetch;globalThis.fetch=keyFetch;try{db.exec("UPDATE app_users SET role='manager' WHERE id='u1'");const token=(await (await handler(request('/v1/session',await jwt(),'POST'),env)).json()).accessToken;env.SYNTHETIC_COMMERCIAL_ENABLED='true';const call=(customerId,command,host='http://localhost')=>handler(new Request(host+'/v1/commercial/'+(command?'commands':'workspace?customerId='+customerId),{method:command?'POST':'GET',headers:{authorization:'Bearer '+token},...(command?{body:JSON.stringify({customerId,command})}:{})}),env);const command={id:'demo-commercial-one',type:'create_account',input:{name:'Demo Commercial'},expectedVersion:0};let response=await call('c2',command);assert.equal(response.status,201);assert.equal(db.prepare('SELECT decision FROM access_audit WHERE id=?').get(response.headers.get('x-request-id')).decision,'allow');assert.equal((await call('c2',command)).status,200);assert.equal((await call('c2',{...command,id:'demo-stale'})).status,409);assert.equal((await call('c3')).status,403);assert.equal((await call('c2',command,'https://public.example')).status,403);const visible=await (await call('c2')).json();assert.equal(visible.accounts.length,1);assert.equal(visible.receipts,undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM records').get().n,4);db.exec("UPDATE customer_profiles SET active=0 WHERE customer_id='c2'; INSERT OR IGNORE INTO customer_profiles(customer_id,display_name,active) VALUES('c2','Demo',0)");assert.equal((await call('c2',{...command,id:'demo-archived',expectedVersion:1})).status,409);db.exec("UPDATE app_users SET role='viewer' WHERE id='u1'");assert.equal((await call('c2')).status,403);env.SYNTHETIC_COMMERCIAL_ENABLED='false';assert.equal((await call('c2')).status,403)}finally{globalThis.fetch=old;db.close()}});
test('concurrent commercial writes preserve one accepted state and audit failure withholds finance',async()=>{const {db,env}=fixture();const old=globalThis.fetch;globalThis.fetch=keyFetch;try{db.exec("UPDATE app_users SET role='manager' WHERE id='u1'");env.SYNTHETIC_COMMERCIAL_ENABLED='true';const token=(await (await handler(request('/v1/session',await jwt(),'POST'),env)).json()).accessToken;const send=id=>handler(new Request('http://localhost/v1/commercial/commands',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({customerId:'c2',command:{id,type:'create_account',input:{name:'Demo Concurrent'},expectedVersion:0}})}),env);const results=await Promise.all([send('demo-race-one'),send('demo-race-two')]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const row=db.prepare("SELECT version,payload FROM commercial_workspaces WHERE customer_id='c2'").get();assert.equal(row.version,1);assert.equal(JSON.parse(row.payload).accounts.length,1);db.exec('DROP TABLE access_audit');const denied=await handler(new Request('http://localhost/v1/commercial/workspace?customerId=c2',{headers:{authorization:'Bearer '+token}}),env);assert.equal(denied.status,503);assert.doesNotMatch(await denied.text(),/Demo Concurrent/)}finally{globalThis.fetch=old;db.close()}});

test('field API isolates assigned drivers, denies certificate privileges, and detects reassignment',async()=>{const {db,env}=fixture();const old=globalThis.fetch;globalThis.fetch=keyFetch;try{env.SYNTHETIC_FIELD_ENABLED='true';db.exec("UPDATE app_users SET role='manager' WHERE id='u1'; INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES('driver1','driver-subject','Demo driver','warehouse',1),('driver2','other-driver','Demo driver 2','warehouse',1); INSERT INTO user_customer_access VALUES('driver1','c2'),('driver2','c2');");const manager=(await (await handler(request('/v1/session',await jwt(),'POST'),env)).json()).accessToken;const driver=(await (await handler(request('/v1/session',await jwt({sub:'driver-subject'}),'POST'),env)).json()).accessToken;const other=(await (await handler(request('/v1/session',await jwt({sub:'other-driver'}),'POST'),env)).json()).accessToken;let state=(await import('../packages/field/workflows.js')).seedField('c2'),n=0;
 const get=token=>handler(new Request('http://localhost/v1/field/workspace?customerId=c2',{headers:{authorization:'Bearer '+token}}),env);
 const send=async(type,input={},token=manager)=>{state=await (await get(manager)).json();const job=state.jobs.find(j=>j.id===input.jobId);const command={clientEventId:'demo-api-'+(++n),type,input,expectedVersion:state.version,expectedJobVersion:job?.version};return handler(new Request('http://localhost/v1/field/commands',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({customerId:'c2',command})}),env)};
 assert.equal((await send('demo_jobs')).status,201);const vehicle=await send('add_vehicle',{name:'Demo Truck',capacity:20,heightCm:350,weightKg:16000});state=(await vehicle.json()).workspace;assert.equal((await send('create_route',{vehicleId:state.vehicles[0].id,driverId:'driver1',date:'2026-11-15',jobIds:state.jobs.map(j=>j.id),startMinute:480,breakMinutes:30,dayLimit:480})).status,201);assert.equal((await (await get(other)).json()).jobs.length,0);const jobId=(await (await get(driver)).json()).jobs[0].id;assert.equal((await send('authorize_demo_destruction',{jobId,reason:'Demo'},driver)).status,403);assert.equal((await send('start_job',{jobId},other)).status,403);const stale=await handler(new Request('http://localhost/v1/field/commands',{method:'POST',headers:{authorization:'Bearer '+driver},body:JSON.stringify({customerId:'c2',command:{type:'start_job',clientEventId:'demo-stale-driver',input:{jobId},expectedJobVersion:0}})}),env);assert.equal(stale.status,409);assert.equal((await send('start_job',{jobId},driver)).status,409);assert.equal((await send('review_job_conflict',{jobId,reason:'Demo supervisor review'})).status,201);assert.equal((await send('start_job',{jobId},driver)).status,201);assert.equal((await send('arrive_job',{jobId},driver)).status,201);for(const barcode of ['DEMO-BIN-0001','DEMO-BIN-0002'])assert.equal((await send('scan_bin',{jobId,barcode},driver)).status,201);assert.equal((await send('complete_job',{jobId,production:2,acknowledgment:'demo-customer'},driver)).status,201);assert.equal((await send('authorize_demo_destruction',{jobId,reason:'Demo approval'})).status,201);assert.equal((await send('perform_demo_destruction',{jobId},driver)).status,201);assert.equal((await send('issue_certificate',{jobId})).status,201);const scoped=await (await get(driver)).json();assert.equal(scoped.certificates.length,0);assert.equal(scoped.telemetry.length,0);state=await (await get(manager)).json();const second=state.jobs[1].id;assert.equal((await send('reassign_job',{jobId:second,driverId:'driver2'})).status,201);assert.equal((await send('start_job',{jobId:second},driver)).status,409);db.exec("UPDATE app_users SET active=0 WHERE id='driver1'");assert.equal((await get(driver)).status,401);assert.equal(db.prepare('SELECT COUNT(*) n FROM records').get().n,4);assert.ok(db.prepare('SELECT COUNT(*) n FROM access_audit').get().n>15)}finally{globalThis.fetch=old;db.close()}});
test('commercial jobs import server-side and completed field custody hands off exactly once to invoice drafting',async()=>{const {db,env}=fixture();const old=globalThis.fetch;globalThis.fetch=keyFetch;try{env.SYNTHETIC_FIELD_ENABLED='true';env.SYNTHETIC_COMMERCIAL_ENABLED='true';db.exec("UPDATE app_users SET role='manager' WHERE id='u1'; INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES('driver','field-driver','Demo field driver','warehouse',1); INSERT INTO user_customer_access VALUES('driver','c2')");const manager=(await (await handler(request('/v1/session',await jwt(),'POST'),env)).json()).accessToken,driver=(await (await handler(request('/v1/session',await jwt({sub:'field-driver'}),'POST'),env)).json()).accessToken;const {seedCommercial,applyCommercial}=await import('../packages/commercial/workflows.js');let c=seedCommercial('c2'),n=0;const apply=(type,input)=>{const id='demo-commercial-'+(++n);c=applyCommercial(c,{id,type,input,expectedVersion:c.version},'u1').state;return id};const accountId=apply('create_account',{name:'Demo Field Billing'});apply('convert_account',{accountId});const locationId=apply('add_location',{accountId,name:'Demo site',address:'100 Fictional Street',timezone:'UTC',windowStart:'08:00',windowEnd:'17:00'});const estimateId=apply('create_estimate',{accountId,locationId,service:'purge',mode:'onsite',unit:'container',quantity:2,unitCents:1000,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0});apply('accept_estimate',{estimateId});apply('schedule_purge',{estimateId,date:'2026-11-15'});db.prepare('INSERT INTO commercial_workspaces(customer_id,version,payload) VALUES(?,?,?)').run('c2',c.version,JSON.stringify(c));let field;const get=async()=>{field=await (await handler(new Request('http://localhost/v1/field/workspace?customerId=c2',{headers:{authorization:'Bearer '+manager}}),env)).json();return field};const send=async(type,input={},token=manager,path='commands')=>{await get();const j=field.jobs.find(j=>j.id===input.jobId);return handler(new Request('http://localhost/v1/field/'+path,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({customerId:'c2',command:{type,input,clientEventId:'demo-integration-'+(++n),expectedVersion:field.version,expectedJobVersion:j?.version}})}),env)};assert.equal((await send('import_jobs',{jobs:[{id:'forged'}]})).status,201);await get();assert.equal(field.jobs.length,1);assert.notEqual(field.jobs[0].commercialJobId,'forged');const jobId=field.jobs[0].id;await send('add_vehicle',{name:'Demo',capacity:10,heightCm:350,weightKg:16000});await get();await send('create_route',{vehicleId:field.vehicles[0].id,driverId:'driver',date:'2026-11-15',jobIds:[jobId],startMinute:480,breakMinutes:30,dayLimit:480});assert.equal((await send('handoff_billing',{jobId},manager,'billing')).status,409);for(const [type,input] of [['start_job',{}],['arrive_job',{}],['scan_bin',{barcode:'DEMO-BIN-0011'}],['scan_bin',{barcode:'DEMO-BIN-0012'}],['complete_job',{production:2,acknowledgment:'demo-client'}]])assert.equal((await send(type,{jobId,...input},driver)).status,201);assert.equal((await send('handoff_billing',{jobId},manager,'billing')).status,201);assert.equal((await send('handoff_billing',{jobId},manager,'billing')).status,200);const saved=JSON.parse(db.prepare("SELECT payload FROM commercial_workspaces WHERE customer_id='c2'").get().payload);assert.equal(saved.jobs[0].status,'completed');assert.equal(saved.events.filter(e=>e.action==='complete_job').length,1);const invoice=applyCommercial(saved,{id:'demo-field-invoice',type:'draft_invoice',input:{accountId,jobIds:[saved.jobs[0].id],from:'2026-11-01',to:'2026-11-30',due:'2026-12-15'},expectedVersion:saved.version},'u1');assert.equal(invoice.state.invoices[0].totalCents,2000)}finally{globalThis.fetch=old;db.close()}});
test('field export background processing is audited, resumable and stops after authorization removal',async()=>{const {db,env}=fixture();const old=globalThis.fetch;globalThis.fetch=keyFetch;try{env.SYNTHETIC_FIELD_ENABLED='true';db.exec("UPDATE app_users SET role='manager' WHERE id='u1'");const token=(await (await handler(request('/v1/session',await jwt(),'POST'),env)).json()).accessToken;const send=(command,context)=>handler(new Request('http://localhost/v1/field/commands',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({customerId:'c2',command})}),env,context);await send({type:'demo_jobs',input:{},clientEventId:'demo-background-seed',expectedVersion:0});const tasks=[];const queued=await send({type:'request_export',input:{},clientEventId:'demo-background-export',expectedVersion:1},{waitUntil:p=>tasks.push(p)});assert.equal(queued.status,201);assert.equal(queued.headers.get('x-synthetic-export-actor'),null);assert.equal(tasks.length,1);await Promise.all(tasks);let state=JSON.parse(db.prepare("SELECT payload FROM field_workspaces WHERE customer_id='c2'").get().payload);assert.equal(state.exports[0].status,'complete');assert.equal(state.exports[0].rows.length,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM access_audit WHERE action='EXPORT_CHUNK'").get().n,1);const {continueFieldExport}=await import('../api/field-export.js');db.exec("DELETE FROM user_customer_access WHERE user_id='u1'");assert.equal((await continueFieldExport(env,'c2','demo-background-export','u1')).status,'auth-required');db.exec("INSERT INTO user_customer_access VALUES('u1','c2')");state.exports[0].status='pending';state.exports[0].rows=[];state.exports[0].offset=0;db.prepare("UPDATE field_workspaces SET payload=? WHERE customer_id='c2'").run(JSON.stringify(state));db.exec('DROP TABLE access_audit');await assert.rejects(continueFieldExport(env,'c2','demo-background-export','u1'));assert.equal(JSON.parse(db.prepare("SELECT payload FROM field_workspaces WHERE customer_id='c2'").get().payload).exports[0].status,'pending')}finally{globalThis.fetch=old;db.close()}});
