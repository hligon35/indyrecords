import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';

const html=readFileSync(new URL('../apps/time-clock/public/index.html',import.meta.url),'utf8');
const app=new Script(readFileSync(new URL('../apps/time-clock/public/app.js',import.meta.url),'utf8'));
const responses={
 '/api/me':{id:'staff',name:'Preview Employee',role:'employee',mode:'simulated'},
 '/api/attendance/profile':{role:'employee'},
 '/api/sites':{sites:[{id:'site',name:'Assigned worksite'}]},
 '/api/attendance/events':{events:[{event_type:'IN',occurred_at:'2026-01-01',provider_state:'SIMULATED'}]},
 '/api/attendance/timecard':{payPeriod:{label:'Nov 8 – Nov 21, 2026',payday:'November 27, 2026'},totals:{paidHours:0,unpaidLunchMinutes:0},estimates:{overtimeMinutes:0}},
 '/api/attendance/notifications':{items:[]},
 '/api/attendance/requests':{requests:[]},
 '/api/attendance/schedules':{schedules:[]}
};

function openClock(t, fetchResponse) {
 const dom=new JSDOM(html,{url:'https://clock.example.test/',runScripts:'outside-only',pretendToBeVisual:true});
 t.after(()=>dom.window.close());
 dom.window.scrollTo=()=>{};
 dom.window.fetch=async (url, options)=>{
  assert.equal(options.credentials,'same-origin');
  assert.equal(options.redirect,'manual');
  return await fetchResponse(url,options)??Response.json(responses[url.split('?')[0]]);
 };
 app.runInContext(dom.getInternalVMContext());
 return dom.window;
}

test('foreground refresh clears account data when Access redirects to login',async t=>{
 let expired=false;
 const window=openClock(t,url=>expired&&url==='/api/me'?{type:'opaqueredirect',status:0}:null);
 await setImmediate();
 const get=id=>window.document.getElementById(id);
 assert.equal(get('connection').textContent,'Signed in');
 assert.match(get('attendance-history').textContent,/SIMULATED/);
 expired=true;
 window.Date.now=()=>Date.now()+2000;
 window.dispatchEvent(new window.Event('irm-clock-resume'));
 await setImmediate();
 assert.equal(get('connection').textContent,'Sign in required');
 assert.equal(get('app').hidden,true);
 assert.equal(get('attendance-history').textContent,'');
 assert.equal(get('sign-in').hidden,false);
 assert.equal(get('notifications-toggle').hidden,false);
 get('notifications-toggle').click();
 assert.match(get('notifications-list').textContent,/ACCESS_LOGIN_REQUIRED/);
 assert.match(get('notifications-list').querySelector('time').dateTime,/Z$/);
 assert.doesNotMatch(get('notifications-list').textContent,/not transmitted to payroll/);
});

test('an Access 401 can be retried and a verified but unprovisioned account gets different guidance',async t=>{
 let accountResponse=new Response('Access login',{status:401});
 const window=openClock(t,url=>url==='/api/me'?accountResponse:null);
 const get=id=>window.document.getElementById(id);
 await setImmediate();
 assert.equal(get('sign-in').hidden,false);
 accountResponse=Response.json({error:'ACCOUNT_NOT_PROVISIONED'},{status:403});
 get('retry-account').click();
 await setImmediate();
 assert.equal(get('sign-in').hidden,true);
 assert.match(get('notice').textContent,/sign-in succeeded/);
 accountResponse=null;
 get('retry-account').click();
 await setImmediate();
 assert.equal(get('connection').textContent,'Signed in');
 assert.equal(get('app').hidden,false);
});

test('the preview location warning appears only in notifications while bypass is active',async t=>{
 let bypass=true;
 const window=openClock(t,url=>url==='/api/attendance/profile'?
  Response.json({role:'employee',previewLocationBypass:bypass}):null);
 await setImmediate();
 const get=id=>window.document.getElementById(id);
 assert.equal(get('notice').className,'visually-hidden');
 assert.equal(get('notifications-panel').hidden,true);
 get('notifications-toggle').click();
 assert.equal(get('notifications-panel').hidden,false);
 const warning=get('notifications-list').querySelector('.alert-entry.warning');
 assert.match(warning.textContent,/Location restrictions are disabled/);
 assert.match(warning.querySelector('time').dateTime,/Z$/);

 bypass=false;
 get('settings-refresh').click();
 await setImmediate();
 assert.doesNotMatch(get('notifications-list').textContent,/Location restrictions are disabled/);
});

test('Clock shows an assigned site label and groups timestamped errors and server notifications',async t=>{
 const window=openClock(t,url=>{
  if(url==='/api/sites')return Response.json({sites:[]});
  if(url==='/api/attendance/notifications')return Response.json({items:[
   {id:'notification',event_kind:'REQUEST_APPROVED',detail:'Your request was approved.',created_at:'2026-11-19 17:00:00'}
  ]});
  return null;
 });
 await setImmediate();
 const get=id=>window.document.getElementById(id);
 assert.equal(get('site').tagName,'STRONG');
 assert.equal(get('site').textContent,'No worksite assigned');
 window.document.querySelector('[data-attendance="IN"]').click();
 assert.equal(get('notifications-toggle').hasAttribute('data-unread'),true);
 get('notifications-toggle').click();
 assert.equal(get('notifications-toggle').hasAttribute('data-unread'),false);
 const list=get('notifications-list');
 assert.match(list.querySelector('.alert-entry.error').textContent,/No worksite is assigned/);
 assert.ok(list.querySelector('time[datetime="2026-11-19T17:00:00.000Z"]'));
 assert.match(list.textContent,/Your request was approved/);
});

test('only a left swipe past 30% deletes a persisted alert',async t=>{
 const id='1491392a-83b0-43e6-9f08-5006157d07ff';
 let deleted=false;
 const window=openClock(t,(url,options)=>{
  if(url==='/api/attendance/notifications/'+id){
   assert.equal(options.method,'DELETE');
   deleted=true;
   return Response.json({deleted:true});
  }
  if(url==='/api/attendance/notifications')return Response.json({items:deleted?[]:[
   {id,event_kind:'APPROVED',detail:'Your request was approved.',created_at:'2026-11-19 17:00:00'}
  ]});
  return null;
 });
 await setImmediate();
 const document=window.document;
 document.getElementById('notifications-toggle').click();
 await setImmediate();
 const row=document.querySelector('.alert-swipe');
 const entry=row.querySelector('.alert-entry');
 row.getBoundingClientRect=()=>({width:200});
 row.setPointerCapture=()=>{};
 const dispatch=(type,x,y)=>entry.dispatchEvent(Object.assign(new window.MouseEvent(type,{
  bubbles:true,clientX:x,clientY:y
 }),{isPrimary:true,pointerId:1}));
 function drag(x,y,end='pointerup'){
  dispatch('pointerdown',180,10);
  dispatch('pointermove',x,y);
  dispatch(end,x,y);
 }
 for(const [x,y,end] of [[120,10],[260,10],[100,100],[100,10,'pointercancel']]){
  drag(x,y,end);
  assert.equal(deleted,false);
  assert.equal(row.isConnected,true);
  assert.equal(entry.style.transform,'');
 }
 drag(119,10);
 await setImmediate();
 assert.equal(deleted,true);
 assert.match(document.getElementById('notifications-list').textContent,/No alerts/);
 document.getElementById('notifications-refresh').click();
 await setImmediate();
 assert.match(document.getElementById('notifications-list').textContent,/No alerts/);
});

test('Request tabs separate a draft correction from the employee history',async t=>{
 const window=openClock(t,url=>url==='/api/attendance/requests'?Response.json({requests:[
  {employee_id:'staff',event_type:'OUT',requested_at:'2026-11-19T17:00:00Z',status:'APPROVED'}
 ]}):null);
 await setImmediate();
 const get=id=>window.document.getElementById(id);
 window.document.querySelector('[data-screen="recent"]').click();
 const newTab=get('request-new-tab');
 const historyTab=get('request-history-tab');
 assert.equal(newTab.getAttribute('aria-selected'),'true');
 assert.equal(get('request-history-panel').hidden,true);
 get('correction-reason').value='Unsubmitted correction';

 newTab.focus();
 newTab.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 assert.equal(window.document.activeElement,historyTab);
 assert.equal(historyTab.getAttribute('aria-selected'),'true');
 assert.equal(get('request-new-panel').hidden,true);
 assert.equal(get('request-history-panel').hidden,false);
 assert.equal(get('request-history-panel').querySelector('h2').textContent,'History');
 assert.match(get('my-corrections').textContent,/APPROVED/);

 newTab.click();
 assert.equal(get('request-history-panel').hidden,true);
 assert.equal(get('request-new-panel').hidden,false);
 assert.equal(get('correction-reason').value,'Unsubmitted correction');
});
