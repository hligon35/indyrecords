import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createApiClient,ApiError} from '../packages/api-client/index.js';
import {CONTRACTS} from '../packages/integrations/adapters.js';
const root=resolve(import.meta.dirname,'..'),baseUrl='http://127.0.0.1:8787',token=process.env.IRM_TEST_SESSION;
if(!token?.startsWith('irm_session_'))throw Error('Temporary verified local IRM_TEST_SESSION required');
const api=createApiClient({baseUrl,getAccessToken:()=>token,readOnly:false}),started=performance.now();
const session=await api.getSession();assert.ok(session.customerIds.includes('c2'));
const initial=(await api.getCustomerProfiles()).items.find(x=>x.customerId==='c2');assert.ok(initial);let profile;
try{
 profile=await api.saveCustomerProfile({...initial,expectedVersion:initial.version,active:false});
 await assert.rejects(api.submitWarehouseCommand('c2',{type:'create_order',clientEventId:crypto.randomUUID(),orderId:'demo-'+crypto.randomUUID(),operation:'Retrieval',barcodes:['IRM-BX-1002']}),error=>error instanceof ApiError&&error.status===409);
}finally{if(profile)await api.saveCustomerProfile({...initial,expectedVersion:profile.version})}
const report=await api.getManagementReport({customerId:'c2',source:'inventory',q:'1002'});assert.equal(report.rows.length,1);assert.equal(report.rows[0].barcode,'IRM-BX-1002');
await assert.rejects(api.getManagementReport({customerId:'c3',source:'inventory'}),error=>error.status===403);
for(const format of ['csv','pdf']){
 const response=await fetch(baseUrl+'/v1/management/report?'+new URLSearchParams({customerId:'c2',source:'inventory',format}),{headers:{authorization:'Bearer '+token},redirect:'error'});assert.equal(response.status,200);assert.ok(response.headers.get('x-request-id'));
 if(format==='pdf')assert.equal(new TextDecoder().decode((await response.arrayBuffer()).slice(0,5)),'%PDF-');else assert.match(await response.text(),/IRM-BX-1002/);
}
const jobs=[];
for(const source of ['andrew','qshred']){
 const csv=await readFile(join(root,'fixtures/integrations/demo-'+source+'-c2.csv'),'utf8');const job=await api.stageIntegration({source,schemaVersion:CONTRACTS[source].version,csv,filename:'demo-'+source+'-c2.csv',sourceTimestamp:new Date().toISOString(),customerId:'c2'});
 assert.equal(job.accepted.length,1);assert.equal(job.reconciliation.matched,1);assert.equal((await api.getIntegrationJob('c2',job.id)).sourceHash,job.sourceHash);jobs.push({source,id:job.id,hash:job.sourceHash});
}
const record=await api.getRecord('IRM-BX-1002');assert.equal(record.customer,'Sample Legal');assert.equal(record.location,'A01-R02');assert.equal(record.status,'Stored');
const evidence={passed:true,synthetic:true,generatedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),checks:['profile versioning/archive','customer isolation','CSV/PDF and audit IDs','Andrew/Q-Shred staging and history','source unchanged'],jobs};
await mkdir(join(root,'dist/readiness'),{recursive:true});await writeFile(join(root,'dist/readiness/localD1.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS: local D1 management, exports, staging, customer isolation and source preservation.');
