import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
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
  assert.equal(options.redirect,'error');
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
 t.mock.method(globalThis,'fetch',async()=>Response.json({keys:{}}));
 await assertApiError({...config,DB:{}},{'Cf-Access-Jwt-Assertion':token()},503,'ACCESS_VERIFICATION_UNAVAILABLE');
});

test('cookie-authenticated writes still require the application origin',async()=>{
 const res=await worker.fetch(new Request(base+'/api/attendance/events',{
  method:'POST',headers:{Origin:'https://other.example.test',Cookie:'CF_Authorization='+token()}
 }),{...config,DB:{}});
 assert.equal(res.status,403);
 assert.equal((await res.json()).error,'SAME_ORIGIN_REQUIRED');
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
