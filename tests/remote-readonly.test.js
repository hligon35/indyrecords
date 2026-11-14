import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyConnection} from '../src/remote-readonly.js';
test('requires HTTPS for remote endpoints',()=>{const connection=createReadOnlyConnection();assert.throws(()=>connection.connect({baseUrl:'http://example.com',accessToken:'x'}),/HTTPS/)});
test('keeps token in memory and searches without mutations',async()=>{let headers;const connection=createReadOnlyConnection({fetchImpl:async(url,opts)=>{headers=opts.headers;return {ok:true,json:async()=>({items:[]})}}});connection.connect({baseUrl:'https://example.test',accessToken:'temporary'});assert.deepEqual(await connection.searchRecords({q:'sample'}),{items:[]});assert.equal(headers.authorization,'Bearer temporary');connection.disconnect();assert.equal(connection.connected,false);await assert.rejects(connection.searchRecords(),/Not connected/)});
test('rejects embedded URL credentials',()=>{const connection=createReadOnlyConnection();assert.throws(()=>connection.connect({baseUrl:'https://user:pass@example.test',accessToken:'x'}),/credentials/)});

test('iterates bounded inventory pages without writing',async()=>{const calls=[];const connection=createReadOnlyConnection({fetchImpl:async(url,opts)=>{calls.push({url,method:opts.method});const cursor=new URL(url).searchParams.get('cursor');return {ok:true,json:async()=>cursor?{items:[{barcode:'B'}],nextCursor:null}:{items:[{barcode:'A'}],nextCursor:'next'}}}});connection.connect({baseUrl:'https://example.test',accessToken:'temporary'});const pages=[];for await(const page of connection.inventoryPages({pageSize:1}))pages.push(page);assert.deepEqual(pages,[[{barcode:'A'}],[{barcode:'B'}]]);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='GET'))});
test('rejects repeated inventory cursors',async()=>{const connection=createReadOnlyConnection({fetchImpl:async()=>({ok:true,json:async()=>({items:[],nextCursor:'repeat'})})});connection.connect({baseUrl:'https://example.test',accessToken:'temporary'});await assert.rejects(async()=>{for await(const page of connection.inventoryPages()){}},/repeated inventory cursor/)});
test('rejects non-origin endpoint paths',()=>{const connection=createReadOnlyConnection();assert.throws(()=>connection.connect({baseUrl:'https://example.test/private',accessToken:'x'}),/origin/)});

test('expires connection and discards credentials on unauthorized response',async()=>{
 const connection=createReadOnlyConnection({fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'Expired'})})});
 connection.connect({baseUrl:'https://example.test',accessToken:'expired'});
 await assert.rejects(connection.searchRecords(),/Expired/);assert.equal(connection.connected,false);assert.equal(connection.endpoint,'');
});
test('disconnect discards in-flight inventory response',async()=>{
 let finish;const connection=createReadOnlyConnection({fetchImpl:()=>new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({items:[{barcode:'secret'}]})})})});
 connection.connect({baseUrl:'https://example.test',accessToken:'temporary'});const result=connection.searchRecords();
 await new Promise(resolve=>setImmediate(resolve));connection.disconnect();finish();await assert.rejects(result,/Connection changed/);
});

test('verified sign-in exchanges identity for a session and logout revokes only that session',async()=>{
 const calls=[];const connection=createReadOnlyConnection({fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method,token:options.headers.authorization});
  return {ok:true,json:async()=>options.method==='POST'?{accessToken:'irm_session_test',expiresAt:Date.now()+60000}:options.method==='DELETE'?{status:'signed_out'}:{user:{id:'user-1',role:'viewer'},customerIds:['c2']}};
 }});
 await connection.signIn({baseUrl:'https://example.test',accessToken:'signed-identity'});assert.equal(connection.connected,true);
 await connection.signOut();assert.equal(connection.connected,false);
 assert.deepEqual(calls.map(x=>x.method),['POST','GET','DELETE']);assert.equal(calls[0].token,'Bearer signed-identity');assert.equal(calls[1].token,'Bearer irm_session_test');assert.equal(calls[2].token,'Bearer irm_session_test');assert.ok(calls.every(x=>x.url.endsWith('/v1/session')));
});
test('failed verified sign-in clears the pending connection',async()=>{
 const connection=createReadOnlyConnection({fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'Invalid identity'})})});
 await assert.rejects(connection.signIn({baseUrl:'https://example.test',accessToken:'bad'}),/Invalid identity/);assert.equal(connection.connected,false);
});
