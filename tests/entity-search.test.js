import test from 'node:test';import assert from 'node:assert/strict';import {operationsFixture} from './helpers/operations-db.js';import {entitySearch} from '../api/entity-search.js';
test('relational entities are created atomically and indexed search remains tenant scoped after source updates',async()=>{
 const f=await operationsFixture();try{
  const search=o=>entitySearch(f.env,'c2',new URLSearchParams(o));const first=await search({domain:'commercial',collection:'accounts',q:'Café'});assert.equal(first.items.length,1);
  const c=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload);c.accounts[0].name='Demo updated indexed name';f.db.prepare('UPDATE commercial_workspaces SET payload=?,version=version+1').run(JSON.stringify(c));
  assert.equal((await search({q:'updated indexed'})).items.length,1);assert.equal((await entitySearch(f.env,'c3',new URLSearchParams())).items.length,0);
  assert.equal((await search({domain:'field',collection:'jobs',status:'assigned'})).items.length,1);
  await assert.rejects(search({domain:'field',collection:'payments'}),/Invalid/);
 }finally{f.db.close()}
});
