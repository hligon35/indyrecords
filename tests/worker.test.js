import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../api/worker.js';
function env(record={id:'r2',kind:'Box'}){
 const calls=[];
 const DB={prepare(sql){const q={bind(...params){calls.push({sql,params});return q},async first(){if(sql.includes('client_event_id=?'))return null;if(sql.includes('WHERE barcode=?'))return record;return null},async all(){return {results:[]}},async run(){return {success:true}}};return q}};
 return {DB,DEMO_API_TOKEN:'local-secret',calls};
}
function req(path,{method='GET',body,token='local-secret'}={}){return new Request('http://localhost'+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
const valid={clientEventId:'evt-0001',barcode:'IRM-BX-1002',operation:'Box Retrieval',mode:'outbound',occurredAt:new Date().toISOString()};
test('missing token is rejected',async()=>{const r=await handler(req('/v1/records',{token:'wrong'}),env());assert.equal(r.status,401)});
test('health endpoint does not require token',async()=>{const r=await handler(new Request('http://localhost/health'),env());assert.equal(r.status,200)});
test('outbound operation in inbound mode is rejected',async()=>{const e=env();const r=await handler(req('/v1/scans',{method:'POST',body:{...valid,mode:'inbound'}}),e);assert.equal(r.status,400);assert.equal(e.calls.length,0)});
test('destruction is blocked',async()=>{const e=env();const r=await handler(req('/v1/scans',{method:'POST',body:{...valid,operation:'Box Destruction'}}),e);assert.equal(r.status,403);assert.equal(e.calls.length,0)});
test('wrong record kind is rejected',async()=>{const r=await handler(req('/v1/scans',{method:'POST',body:{...valid,operation:'File Retrieval'}}),env());assert.equal(r.status,409)});
test('valid synthetic scan gets server acknowledgement',async()=>{const e=env();const r=await handler(req('/v1/scans',{method:'POST',body:valid}),e);assert.equal(r.status,201);assert.equal((await r.json()).status,'accepted');assert.ok(e.calls.some(x=>x.sql.startsWith('INSERT INTO scan_events')))});
test('work-order-linked scans fail closed',async()=>{const r=await handler(req('/v1/scans',{method:'POST',body:{...valid,workOrderId:'wo1'}}),env());assert.equal(r.status,501)});
test('invalid barcode is rejected before DB lookup',async()=>{const e=env();const r=await handler(req('/v1/scans',{method:'POST',body:{...valid,barcode:'../../bad'}}),e);assert.equal(r.status,400);assert.equal(e.calls.length,0)});
