import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyConnection} from '../src/remote-readonly.js';
test('requires HTTPS for remote endpoints',()=>{const connection=createReadOnlyConnection();assert.throws(()=>connection.connect({baseUrl:'http://example.com',accessToken:'x'}),/HTTPS/)});
test('keeps token in memory and searches without mutations',async()=>{let headers;const connection=createReadOnlyConnection({fetchImpl:async(url,opts)=>{headers=opts.headers;return {ok:true,json:async()=>({items:[]})}}});connection.connect({baseUrl:'https://example.test',accessToken:'temporary'});assert.deepEqual(await connection.searchRecords({q:'sample'}),{items:[]});assert.equal(headers.authorization,'Bearer temporary');connection.disconnect();assert.equal(connection.connected,false);await assert.rejects(connection.searchRecords(),/Not connected/)});
test('rejects embedded URL credentials',()=>{const connection=createReadOnlyConnection();assert.throws(()=>connection.connect({baseUrl:'https://user:pass@example.test',accessToken:'x'}),/credentials/)});
