import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionController} from '../packages/security/session-controller.js';
import {protectedDatabaseFactory} from '../packages/security/protected-database.js';
const candidate={baseUrl:'https://api.example',accessToken:'irm_session_test',expiresAt:10000};
test('shared account session persists only a short-lived credential and restores verified role/scope',async()=>{
 let raw=null,locks=0,clock=1000;
 const deps={storage:{getItem:async()=>raw,setItem:async(k,v)=>{raw=v},deleteItem:async()=>{raw=null}},verify:async()=>({user:{id:'u1',role:'warehouse'},customerIds:['c2']}),revoke:async()=>{},onLock:()=>locks++,now:()=>clock};
 const c=createSessionController(deps);await c.setSession(candidate);assert.equal(c.current.user.id,'u1');assert.equal(JSON.parse(raw).identityCache.user.role,'warehouse');assert.ok(!raw.includes('untrustedExtra'));
 const restored=createSessionController(deps);await restored.restore();assert.equal(restored.current.user.role,'warehouse');
 clock=11000;assert.equal(c.current,null);await new Promise(r=>setTimeout(r,0));assert.equal(raw,null);assert.ok(locks>0);
});
test('sign-out during an in-flight sign-in cannot resurrect a saved session and revocation clears every subscriber',async()=>{
 let finish,raw=null;const c=createSessionController({storage:{getItem:async()=>raw,setItem:async(k,v)=>{raw=v},deleteItem:async()=>{raw=null}},verify:()=>new Promise(r=>{finish=r}),revoke:async()=>{},now:()=>1000});
 const signing=c.setSession(candidate);await c.clear();finish({user:{id:'u1'},customerIds:['c2']});await assert.rejects(signing,/changed/);assert.equal(c.current,null);assert.equal(raw,null);
});
test('revoked account access clears shared credentials and triggers protected-store locking',async()=>{
 let revoked=false,locks=0;const c=createSessionController({storage:{getItem:async()=>null,setItem:async()=>{},deleteItem:async()=>{}},verify:async()=>{if(revoked)throw Object.assign(Error('revoked'),{status:403});return {user:{id:'u1'},customerIds:['c2']}},revoke:async()=>{},onLock:()=>locks++,now:()=>1000});
 await c.setSession(candidate);revoked=true;await assert.rejects(c.verifyCurrent(),/revoked/);assert.equal(c.current,null);assert.equal(locks,2);
});
test('protected database refuses plaintext fallback and never replaces a missing key for existing encrypted data',async()=>{
 let saved=0,closed=0;
 const setup=(cipher,existing)=>protectedDatabaseFactory({hash:async()=> 'a'.repeat(64),randomHex:()=> 'b'.repeat(64),secureStore:{getItem:async()=>null,setItem:async()=>saved++},openDatabase:async()=>({getFirstAsync:async sql=>{if(sql==='PRAGMA cipher_version')return cipher?{cipher_version:'4'}:null;if(existing)throw Error('Encrypted');return {n:0}},execAsync:async()=>{},closeAsync:async()=>closed++})});
 await assert.rejects(setup(false,false)('u1','c2'),/plaintext fallback/);assert.equal(saved,0);
 await assert.rejects(setup(true,true)('u1','c2'),/key is missing/);assert.equal(saved,0);assert.equal(closed,2);
});
test('protected database generates a scoped secure key and applies it before any table creation',async()=>{
 const calls=[],keys=new Map();
 const open=protectedDatabaseFactory({hash:async value=>value.includes('u1')?'a'.repeat(64):'c'.repeat(64),randomHex:()=> 'b'.repeat(64),secureStore:{getItem:async k=>keys.get(k),setItem:async(k,v)=>{keys.set(k,v);calls.push('secure-key-saved')}},openDatabase:async name=>{calls.push(name);return {getFirstAsync:async sql=>sql==='PRAGMA cipher_version'?{cipher_version:'4'}:{n:0},execAsync:async sql=>calls.push(sql)}}});
 await open('u1','c2');await open('u2','c2');assert.equal(keys.size,2);assert.match(calls[2],/PRAGMA key/);assert.ok(!calls.some(x=>x.includes('CREATE TABLE')));
});
test('account sign-out revokes the server even when local credential deletion fails',async()=>{
 let revoked=false;const c=createSessionController({storage:{getItem:async()=>null,setItem:async()=>{},deleteItem:async()=>{throw Error('Key store unavailable')}},verify:async()=>({user:{id:'u1'},customerIds:['c2']}),revoke:async()=>{revoked=true},now:()=>1000});
 await c.setSession(candidate);await assert.rejects(c.clear({remote:true}),/Key store/);assert.equal(c.current,null);assert.equal(revoked,true);
});
test('verified role/grant changes lock previously opened protected scopes',async()=>{
 let changed=false,locks=0;const c=createSessionController({storage:{getItem:async()=>null,setItem:async()=>{},deleteItem:async()=>{}},verify:async()=>({user:{id:'u1',role:changed?'viewer':'warehouse'},customerIds:changed?[]:['c2']}),revoke:async()=>{},onLock:()=>locks++,now:()=>1000});
 await c.setSession(candidate);changed=true;await c.verifyCurrent();assert.equal(c.current.user.role,'viewer');assert.equal(locks,2);
});
test('client expiry is clamped to the verified server session and cannot be extended by cached data',async()=>{
 let serverExpiry=8000;const c=createSessionController({storage:{getItem:async()=>null,setItem:async()=>{},deleteItem:async()=>{}},verify:async()=>({user:{id:'u1'},customerIds:['c2'],expiresAt:serverExpiry}),revoke:async()=>{},now:()=>1000});
 await c.setSession({...candidate,expiresAt:999999999});assert.equal(c.current.expiresAt,8000);serverExpiry=5000;await c.verifyCurrent();assert.equal(c.current.expiresAt,5000);
});
test('offline restart can resume a protected verified identity only within its original short expiry',async()=>{
 let raw=null,offline=false;const options={storage:{getItem:async()=>raw,setItem:async(k,v)=>{raw=v},deleteItem:async()=>{raw=null}},verify:async()=>{if(offline)throw new TypeError('Network unavailable');return {user:{id:'u1',role:'warehouse'},customerIds:['c2'],expiresAt:8000}},revoke:async()=>{},now:()=>1000};
 const online=createSessionController(options);await online.setSession(candidate);offline=true;const restarted=createSessionController(options);await restarted.restore();assert.equal(restarted.current.offline,true);assert.equal(restarted.current.expiresAt,8000);
 offline=false;await restarted.verifyCurrent();assert.equal(restarted.current.offline,false);
 const expired=createSessionController({...options,now:()=>9000});assert.equal(await expired.restore(),null);
});
test('revoked sessions never fall back to a cached offline identity',async()=>{
 let raw=null,revoked=false;const options={storage:{getItem:async()=>raw,setItem:async(k,v)=>{raw=v},deleteItem:async()=>{raw=null}},verify:async()=>{if(revoked)throw Object.assign(Error('Revoked'),{status:401});return {user:{id:'u1',role:'warehouse'},customerIds:['c2']}},revoke:async()=>{},now:()=>1000};
 await createSessionController(options).setSession(candidate);revoked=true;const c=createSessionController(options);assert.equal(await c.restore(),null);assert.equal(raw,null);
});
