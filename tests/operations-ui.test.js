import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createOperationsView} from '../src/operations-view.js';
import {buildSampleDataset} from '../packages/operations/sample.js';
test('basic Operations UI previews and downloads a complete sample without requiring an API',async()=>{
 const root=new JSDOM('<main></main>').window.document.querySelector('main'), downloads=[];
 const view=createOperationsView({remote:{revision:0,connected:false,user:null},onDownload:(name,data)=>downloads.push({name,data})});
 function render(){root.innerHTML=view.html();view.bind(root,render)}render();
 assert.equal(root.querySelector('#op-install').disabled,true);
 await root.querySelector('#op-preview').onclick();assert.match(root.textContent,/warehouseRecords/);
 await root.querySelector('#op-download').onclick();assert.equal(downloads[0].data.manifest.counts.accounts,4);
 assert.equal(downloads[0].data.field.certificates[0].title,'SAMPLE / NOT PROOF OF DESTRUCTION');
});
test('Operations UI queues sources from verified workspaces, downloads backend documents and clears on account changes',async()=>{
 const sample=await buildSampleDataset('c2'),root=new JSDOM('<main></main>').window.document.querySelector('main'),queued=[],downloads=[];
 const remote={revision:0,connected:true,user:{id:'manager',role:'manager'},async getOperationsStatus(){return {providers:[],sensitiveMarker:'private-c2'}},async getOperationsTasks(){return {items:[],nextCursor:null}},async getCommercialWorkspace(){return sample.commercial},async getFieldWorkspace(){return sample.field},async enqueueOperation(input){queued.push(input)},async getOperationsDocument(){return {filename:'sample.pdf',content:'JVBERi0=',encoding:'base64',contentType:'application/pdf'}}};
 const view=createOperationsView({remote,onDownload:(name,data)=>downloads.push({name,data})});function render(){root.innerHTML=view.html();view.bind(root,render)}render();
 await root.querySelector('#op-load').onclick();assert.match(root.textContent,/private-c2/);
 await root.querySelector('#op-enqueue').onclick();assert.equal(queued.length,1);assert.equal(queued[0].customerId,'c2');assert.ok(queued[0].task.requestKey.startsWith('demo-'));
 await root.querySelector('#op-document-download').onclick();assert.equal(downloads[0].data.contentType,'application/pdf');
 remote.revision++;remote.connected=false;remote.user=null;render();assert.ok(!root.textContent.includes('private-c2'));assert.equal(root.querySelector('#op-document-download').disabled,true);
});
