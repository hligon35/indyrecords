import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient,ApiError,classifyScanFailure} from '../packages/api-client/index.js';
test('API client sends authorization and encodes search',async()=>{let url,headers;const api=createApiClient({baseUrl:'https://example.test/',getAccessToken:async()=> 'test-token',fetchImpl:async(u,opts)=>{url=u;headers=opts.headers;return {ok:true,json:async()=>({items:[]})}}});await api.searchRecords({q:'box & file'});assert.match(url,/box%20%26%20file|box\+%26\+file/);assert.equal(headers.authorization,'Bearer test-token')});
test('missing token blocks requests',async()=>{const api=createApiClient({baseUrl:'https://example.test',getAccessToken:async()=>null,fetchImpl:()=>{throw Error('should not call fetch')}});await assert.rejects(api.getSummary(),{status:401})});
test('failed API requests preserve status',async()=>{const api=createApiClient({baseUrl:'https://example.test',getAccessToken:()=> 'token',fetchImpl:async()=>({ok:false,status:409,json:async()=>({error:'Conflict'})})});await assert.rejects(api.submitScan({}),{status:409})});
test('authentication errors do not retry blindly',()=>{assert.equal(classifyScanFailure(new ApiError('Expired',401)),'reauthenticate');assert.equal(classifyScanFailure(new ApiError('Unavailable',503)),'retry')});
