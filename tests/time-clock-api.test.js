import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/time-clock/worker.js';
const base='https://clock.example.test';
const issuer='https://irm-example.cloudflareaccess.com';
const audience='clock-audience';
const config={ACCESS_ISSUER:issuer+'/',ACCESS_AUDIENCE:audience};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const signingKey={...publicKey.export({format:'jwk'}),kid:'active'};

function token(overrides={}, header={}) {
 const now=Math.floor(Date.now()/1000);
 const encode=data=>Buffer.from(JSON.stringify(data)).toString('base64url');
 const data=encode({alg:'RS256',kid:'active',...header})+'.'+encode({
  iss:issuer,aud:[audience],sub:'employee-subject',iat:now-5,exp:now+300,...overrides
 });
 return data+'.'+sign('sha256',Buffer.from(data),privateKey).toString('base64url');
}

function staffDatabase(employee) {
 return {prepare(sql) {
  assert.match(sql,/identity_sub=\? AND active=1/);
  return {bind(subject) {
   assert.equal(subject,'employee-subject');
   return {first:async()=>employee};
  }};
 }};
}

async function assertApiError(env, headers, status, code) {
 const res=await worker.fetch(new Request(base+'/api/me',{headers}),env);
 assert.equal(res.status,status);
 assert.deepEqual(await res.json(),{error:code});
}

test('API is unavailable without a dedicated D1 binding',async()=>{
 const res=await worker.fetch(new Request(base+'/api/me'),{});
 assert.equal(res.status,503);
 assert.equal((await res.json()).error,'DATABASE_NOT_CONFIGURED');
});
test('API distinguishes missing configuration from missing Access credentials',async()=>{
 await assertApiError({DB:{}},{},503,'ACCESS_CONFIGURATION_REQUIRED');
 await assertApiError({...config,ACCESS_ISSUER:issuer+'/path',DB:{}},{},503,'ACCESS_CONFIGURATION_REQUIRED');
 await assertApiError({...config,DB:{}},{'Cf-Access-Authenticated-User-Email':'claimed@example.test'},401,'ACCESS_TOKEN_NOT_FORWARDED');
});

test('a verified header or application cookie reaches D1 provisioning',async t=>{
 t.mock.method(globalThis,'fetch',async (url,options)=>{
  assert.equal(url,issuer+'/cdn-cgi/access/certs');
  assert.equal(options.redirect,'manual');
  return Response.json({keys:[signingKey]});
 });
 const DB=staffDatabase({id:'employee-id',display_name:'Preview Employee',role:'employee'});
 const jwt=token();
 for(const headers of [
  {'Cf-Access-Jwt-Assertion':jwt,Cookie:'CF_Authorization=invalid'},
  {Cookie:'other=value; CF_Authorization='+jwt}
 ]){
  const res=await worker.fetch(new Request(base+'/api/me',{headers}),{...config,DB});
  assert.equal(res.status,200);
  assert.equal((await res.json()).id,'employee-id');
 }
 await assertApiError({...config,DB:staffDatabase(null)},{Cookie:'CF_Authorization='+jwt},403,'ACCOUNT_NOT_PROVISIONED');
});

test('credentials fail closed on invalid signature, claims, algorithm or ambiguous source',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({keys:[signingKey]}));
 const jwt=token();
 const tampered=jwt.split('.');
 tampered[1]=Buffer.from(JSON.stringify({
  iss:issuer,aud:[audience],sub:'tampered',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300
 })).toString('base64url');
 for(const credential of [
  tampered.join('.'),token({aud:['different-app']}),token({iss:'https://other.cloudflareaccess.com'}),
  token({exp:1}),token({iat:4102444800}),token({nbf:4102444800}),token({nbf:'0'}),token({sub:''}),
  token({}, {alg:'none'}),token({}, {kid:'unknown'}),'bad.jwt.signature',
  Buffer.from('null').toString('base64url')+'.'+jwt.split('.').slice(1).join('.')
 ]){
  await assertApiError({...config,DB:{}},{Cookie:'CF_Authorization='+credential},401,'ACCESS_TOKEN_INVALID_OR_EXPIRED');
 }
 await assertApiError({...config,DB:{}},{'Cf-Access-Jwt-Assertion':'invalid',Cookie:'CF_Authorization='+jwt},401,'ACCESS_TOKEN_INVALID_OR_EXPIRED');
 await assertApiError({...config,DB:{}},{Cookie:'CF_Authorization='+jwt+'; CF_Authorization=invalid'},401,'ACCESS_TOKEN_NOT_FORWARDED');
});

test('key service failures are reported separately and skip employee lookup',async t=>{
 const redirect=Response.json({keys:[signingKey]},{
  status:302,headers:{Location:'https://other.example.test/certs'}
 });
 const readRedirectBody=t.mock.method(redirect,'json');
 const fetchKeys=t.mock.method(globalThis,'fetch',async()=>redirect);
 const headers={'Cf-Access-Jwt-Assertion':token()};
 const env={...config,DB:{}};
 await assertApiError(env,headers,503,'ACCESS_VERIFICATION_UNAVAILABLE');
 assert.equal(fetchKeys.mock.callCount(),1);
 assert.equal(readRedirectBody.mock.callCount(),0);

 fetchKeys.mock.mockImplementation(async()=>new Response(null,{status:502}));
 await assertApiError(env,headers,503,'ACCESS_VERIFICATION_UNAVAILABLE');

 fetchKeys.mock.mockImplementation(async()=>Response.json({keys:{}}));
 await assertApiError(env,headers,503,'ACCESS_VERIFICATION_UNAVAILABLE');
});

test('cookie-authenticated writes still require the application origin',async()=>{
 const res=await worker.fetch(new Request(base+'/api/attendance/events',{
  method:'POST',headers:{Origin:'https://other.example.test',Cookie:'CF_Authorization='+token()}
 }),{...config,DB:{}});
 assert.equal(res.status,403);
 assert.equal((await res.json()).error,'SAME_ORIGIN_REQUIRED');
});

test('only the configured active admin can replace an assigned worksite',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({keys:[signingKey]}));
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 sqlite.exec(readFileSync(new URL('../apps/time-clock/migrations/0001.sql',import.meta.url),'utf8'));
 sqlite.exec(`
  INSERT INTO employees(id,identity_sub,display_name,role) VALUES
    ('owner','owner-sub','Owner','admin'),('admin','admin-sub','Administrator','admin'),
    ('staff','staff-sub','Employee','employee');
  INSERT INTO worksites(id,name,latitude,longitude,enabled) VALUES
    ('old','Old site',0,0,1),('new','New site',0,0,1),('disabled','Disabled site',0,0,0);
  INSERT INTO assignments(employee_id,worksite_id) VALUES ('admin','old'),('staff','old');
 `);
 const DB={
  prepare(sql){
   const statement=sqlite.prepare(sql);
   const bind=(...args)=>({
    first:()=>statement.get(...args),
    all:()=>({results:statement.all(...args)}),
    run:()=>({meta:statement.run(...args)})
   });
   return {bind};
  },
  batch(statements){
   sqlite.exec('BEGIN');
   try{
    const results=statements.map(statement=>statement.run());
    sqlite.exec('COMMIT');
    return results;
   }catch(error){
    sqlite.exec('ROLLBACK');
    throw error;
   }
  }
 };
 const call=(sub,path,method='GET',worksiteId='new',owner='owner-sub')=>worker.fetch(new Request(base+path,{
  method,headers:{Origin:base,'Cf-Access-Jwt-Assertion':token({sub})},
  body:method==='GET'?undefined:JSON.stringify({employeeId:'staff',worksiteId})
 }),{...config,DB,WORKSITE_OWNER_SUBJECT:owner});
 const assignments=()=>sqlite.prepare("SELECT worksite_id FROM assignments WHERE employee_id='staff'").all().map(row=>row.worksite_id);
 const adminSites=await call('admin-sub','/api/sites');
 assert.deepEqual((await adminSites.json()).sites.map(site=>site.id),['old']);
 assert.equal((await (await call('owner-sub','/api/me')).json()).canManageWorksites,true);
 for(const [sub,configured] of [['admin-sub','owner-sub'],['staff-sub','staff-sub'],['owner-sub','']]){
  const denied=await call(sub,'/api/admin/assignments','PUT','new',configured);
  assert.equal(denied.status,403);
  assert.deepEqual(await denied.json(),{error:'OWNER_REQUIRED'});
 }
 assert.equal((await call('admin-sub','/api/admin/assignments','POST')).status,403);
 assert.equal((await call('admin-sub','/api/admin/sites','POST')).status,403);
 assert.equal((await call('owner-sub','/api/admin/assignments','PUT','disabled')).status,400);
 assert.deepEqual(assignments(),['old']);
 assert.equal((await call('owner-sub','/api/admin/assignments','PUT')).status,200);
 assert.deepEqual(assignments(),['new']);
 assert.equal(sqlite.prepare("SELECT actor_id FROM audit_log WHERE operation='WORKSITE_ASSIGNMENT_CHANGED'").get().actor_id,'owner');
});
test('dismissed notifications are removed only from the addressed employee inbox',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({keys:[signingKey]}));
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 for(const migration of ['0001.sql','0003_attendance.sql']){
  sqlite.exec(readFileSync(new URL('../apps/time-clock/migrations/'+migration,import.meta.url),'utf8'));
 }
 const mine='1491392a-83b0-43e6-9f08-5006157d07ff';
 const other='91cc8826-2460-4d45-97dd-18aeb9a80445';
 sqlite.exec("INSERT INTO employees(id,identity_sub,display_name) VALUES ('mine','employee-subject','Mine'),('other','other-subject','Other')");
 const insert=sqlite.prepare("INSERT INTO attendance_notifications(id,employee_id,event_kind,detail) VALUES (?,?,'APPROVED','Approved')");
 insert.run(mine,'mine');
 insert.run(other,'other');
 const DB={prepare(sql){
  const statement=sqlite.prepare(sql);
  return {bind(...args){return {
   first:()=>statement.get(...args),
   all:()=>({results:statement.all(...args)}),
   run:()=>statement.run(...args)
  }}};
 }};
 const url=base+'/api/attendance/notifications';
 const headers={Origin:base,'Cf-Access-Jwt-Assertion':token()};
 for(const id of [other,mine,mine]){
  const result=await worker.fetch(new Request(url+'/'+id,{method:'DELETE',headers}),{...config,DB});
  assert.equal(result.status,200);
 }
 const inbox=await worker.fetch(new Request(url,{headers}),{...config,DB});
 assert.deepEqual(await inbox.json(),{items:[]});
 assert.deepEqual(sqlite.prepare('SELECT id FROM attendance_notifications').all().map(row=>row.id),[other]);
});
test('static requests use isolated assets binding',async()=>{
 const res=await worker.fetch(new Request(base+'/'),{ASSETS:{fetch:async()=>new Response('clock UI')}});
 assert.equal(res.status,200);
 assert.equal(await res.text(),'clock UI');
});
test('static requests fail closed without deployment assets',async()=>{
 const res=await worker.fetch(new Request(base+'/'),{});
 assert.equal(res.status,503);
});
