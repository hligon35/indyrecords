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
 '/api/attendance/timecard':{totals:{paidHours:0,unpaidLunchMinutes:0},estimates:{overtimeMinutes:0}},
 '/api/attendance/notifications':{items:[]},
 '/api/attendance/requests':{requests:[]}
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
 assert.match(get('notice').textContent,/ACCESS_LOGIN_REQUIRED/);
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
 assert.equal(get('notice').textContent,'');
 assert.equal(get('notifications-panel').hidden,true);
 get('notifications-toggle').click();
 assert.equal(get('notifications-panel').hidden,false);
 assert.equal(get('preview-warning').hidden,false);
 assert.match(get('preview-warning').textContent,/Location restrictions are disabled/);

 bypass=false;
 get('settings-refresh').click();
 await setImmediate();
 assert.equal(get('notice').textContent,'');
 assert.equal(get('preview-warning').hidden,true);
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
