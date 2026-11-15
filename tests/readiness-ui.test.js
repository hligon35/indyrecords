import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createReadinessView} from '../src/readiness-view.js';
test('basic report screen downloads every export page and clears retained financial data on account change',async()=>{
 const root=new JSDOM('<main></main>').window.document.querySelector('main'),files=[],calls=[];
 const remote={revision:0,async getOperationsResource(kind,options){calls.push([kind,options]);if(kind==='exports')return {items:[{id:'x',status:'complete',version:1}],nextCursor:null};if(kind==='exports/chunk')return {filename:'sample.csv',content:options.offset===0?'header\r\nrow1\r\n':'row2\r\n',nextOffset:options.offset===0?1:null};if(kind==='reconciliation')return {items:[{id:'r1',status:'open',report:'private-marker'}]};if(kind==='archive')return {items:[]};return {alerts:[]}},async operationsResourceCommand(){return {}},async runOperations(){return {}}};
 const view=createReadinessView({remote,onDownload:file=>files.push(file)});function render(){root.innerHTML=view.html();view.bind(root,render)}render();
 await root.querySelector('#ready-load').onclick();assert.match(root.textContent,/private-marker/);
 await root.querySelector('[data-ready-download]').onclick();assert.equal(files[0].content,'header\r\nrow1\r\nrow2\r\n');
 remote.revision++;render();assert.ok(!root.textContent.includes('private-marker'));assert.equal(root.querySelector('[data-ready-download]'),null);
});
