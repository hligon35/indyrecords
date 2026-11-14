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
 for(const file of ['migrations/0001_initial.sql','migrations/0002_auth_audit_foundation.sql','migrations/0003_sessions.sql','scripts/seed-demo.sql'])db.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES('u1','subject-1','Synthetic User','viewer',1); INSERT INTO user_customer_access VALUES('u1','c2');");
 const DB={prepare(sql){let params=[];const query={bind(...values){params=values;return query},async first(){return db.prepare(sql).get(...params)||null},async all(){return {results:db.prepare(sql).all(...params)}},async run(){db.prepare(sql).run(...params);return {success:true}}};return query}};
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
