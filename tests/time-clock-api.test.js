import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../apps/time-clock/worker.js';
const base='https://clock.example.test';
test('API is unavailable without a dedicated D1 binding',async()=>{
 const res=await worker.fetch(new Request(base+'/api/me'),{});
 assert.equal(res.status,503);
 assert.equal((await res.json()).error,'DATABASE_NOT_CONFIGURED');
});
test('API fails closed without verified Access identity',async()=>{
 const res=await worker.fetch(new Request(base+'/api/me'),{DB:{}});
 assert.equal(res.status,401);
 assert.equal((await res.json()).error,'SIGN_IN_REQUIRED');
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
