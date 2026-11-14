import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
async function settled(){for(let i=0;i<250;i++){await wait();if(!document.querySelector('#warehouse-create[disabled]'))return}throw Error('Warehouse operation did not settle')}
test('existing interface and complete synthetic warehouse round trip remain usable',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../index.html',import.meta.url),'utf8'),{url:'https://app.example'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage});
 const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>new Response(JSON.stringify(url.endsWith('/v1/session')?{user:{id:'viewer',role:'viewer'},customerIds:['c2']}:url.includes('/v1/records?')?{items:[{barcode:'IRM-BX-1002',kind:'Box',customer:'<script>unsafe</script>',status:'Stored',location:'A01-R02'}]}:{barcode:'IRM-BX-1002',kind:'Box',customer:'<script>unsafe</script>',status:'Stored',location:'A01-R02'}));
 try{
  await import('../src/app.js?ui-test');await wait();
  const select=css=>document.querySelector(css);
  const navigate=page=>select('[data-page="'+page+'"]').click();
  navigate('inventory');assert.equal(select('tbody').children.length,120);
  navigate('scanner');select('#barcode').value='IRM-BX-1002';select('#scan').click();assert.match(select('#view').textContent,/Pending demo sync/);
  navigate('warehouse');select('[data-warehouse-record]').checked=true;select('#warehouse-create').click();await settled();
  const action=type=>[...document.querySelectorAll('[data-warehouse-command]')].find(x=>JSON.parse(x.dataset.warehouseCommand).type===type);
  for(const type of ['pick','stage','dispatch','deliver']){assert.ok(action(type),type+' available');action(type).click();await settled()}
  assert.match(select('#view').textContent,/AtCustomer/);
  select('[data-warehouse-record]').checked=true;select('#warehouse-operation').value='Refile';select('#warehouse-create').click();await settled();
  for(const type of ['receive','stage','refile']){assert.ok(action(type));action(type).click();await settled()}
  const state=JSON.parse(localStorage.getItem('irm-warehouse-c2'));assert.equal(state.records[0].status,'Stored');assert.equal(state.orders[1].status,'closed');assert.equal(state.custody.length,9);
  navigate('remote');
  select('#remote-url').value='https://api.example';select('#remote-token').value='irm_session_ui';await select('#remote-connect').onclick();await select('#remote-fetch').onclick();await select('[data-remote-barcode]').onclick();assert.match(select('#view').textContent,/Record details/);assert.equal(select('#view script'),null);await select('#remote-disconnect').onclick();assert.doesNotMatch(select('#view').textContent,/Record details/);
  navigate('overview');assert.match(select('#view').textContent,/120/);
 }finally{globalThis.fetch=originalFetch;dom.window.close()}
});
test('interactive login rejects mismatched state and removes code from browser history',async()=>{
 const {finishLogin}=await import('../src/login.js');let clean=false;
 const storage={getItem:()=>JSON.stringify({state:'expected',createdAt:Date.now()}),removeItem(){}};
 await assert.rejects(finishLogin({storage,location:{hash:'#irm_login_code=code&state=wrong',pathname:'/',search:''},history:{replaceState(){clean=true}},fetchImpl:()=>{throw Error('Must not send')}}),/state/);
 assert.equal(clean,true);
});
