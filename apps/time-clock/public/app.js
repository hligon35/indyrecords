const $=id=>document.getElementById(id);let me=null,sites=[];let busy=false;let testLocationBypass=false;let refreshing=null;let lastRefreshAt=0;
const note=(message,type='')=>{$('notice').textContent=message;$('notice').className='notice '+type;};
const clean=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){
 const res=await fetch('/api'+path,{...options,cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json',...options.headers}});
 let json;try{json=await res.json()}catch{throw Error('Invalid server response')}
 if(!res.ok)throw Error(json.error||'Request failed');
 return json;
}
const selected=()=>sites.find(x=>x.id===$('site').value);
function showSite(){
 const s=selected();if(!s)return;
 $('site-detail').textContent=s.geofence_enabled?'Location required within '+s.radius_feet+' feet of this worksite.':'Location restriction is disabled for this site.';
 if(me.role==='admin'){$('site-name').value=s.name;$('latitude').value=s.latitude;$('longitude').value=s.longitude;$('radius').value=s.radius_feet;$('radius-output').textContent=s.radius_feet+' feet';$('geofence-enabled').checked=Boolean(s.geofence_enabled)}
}
async function loadSites(){
 const {sites:items}=await api('/sites');const prior=$('site').value;sites=items;
 $('site').replaceChildren(...items.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o}));
 if(items.some(s=>s.id===prior))$('site').value=prior;
 showSite();
}
async function history(){
 const {punches}=await api('/history');
 $('history').innerHTML=punches.length?punches.map(p=>'<div class="history-row"><div><strong>'+clean(p.type.replace('_',' '))+'</strong><small>'+clean(new Date(p.submitted_at).toLocaleString())+'</small></div><div class="state">'+clean(p.provider_state)+(p.provider_state==='PENDING'?'<button data-status="'+clean(p.id)+'">Check status</button>':'')+'</div></div>').join(''):'<p class="hint">No punches have been submitted.</p>';
 $('history').querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{const status=await api('/punches/'+encodeURIComponent(button.dataset.status)+'/status');note('Provider status: '+status.state+'. '+(status.message||''),status.state==='FAILED'?'error':'success');await history()}catch(e){note(e.message,'error')}finally{button.disabled=false}}));
}
function getLocation(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(Error('This device does not support location verification.'));
  navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracyMeters:p.coords.accuracy,capturedAt:p.timestamp}),e=>reject(Error(e.code===1?'Location permission is required. Enable location access and retry.':'Could not verify a current location. Move into open space and retry.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 });
}
async function punch(type){
 if(busy)return;const site=selected();if(!site)return note('No worksite is assigned to your account. Contact an administrator.','error');
 busy=true;document.querySelectorAll('[data-attendance]').forEach(b=>b.disabled=true);
 const requestId=crypto.randomUUID();
 try{
  note('Checking location and submitting '+type.toLowerCase().replace('_',' ')+'…');
  const location=site.geofence_enabled&&!testLocationBypass?await getLocation():null;
  const {event:p}=await api('/attendance/events',{method:'POST',body:JSON.stringify({type,worksiteId:site.id,requestId,location})});
  note(p.provider_state==='CONFIRMED'?'Punch confirmed by the connected provider.':p.provider_state==='SIMULATED'?'Attendance event saved in SIMULATION. Not sent to ADP.':'Punch status: '+p.provider_state+'. '+(p.provider_message||'Check status before retrying.'),p.provider_state==='UNKNOWN'?'error':'success');
  await Promise.all([history(),attendanceHistory()]);
 }catch(e){note(e.message,'error')}finally{busy=false;document.querySelectorAll('[data-attendance]').forEach(b=>b.disabled=false)}
}
async function refreshAccount(){
 if(refreshing)return refreshing;
 refreshing=(async()=>{
  try{
   const account=await api('/me');
   const priorIdentity=me?.id;
   me=account;
   if(priorIdentity&&priorIdentity!==me.id){
    // Never show one employee's cached data to a different signed-in identity.
    $('history').replaceChildren();$('attendance-history').replaceChildren();
    $('notifications-list').replaceChildren();$('my-corrections').replaceChildren();
    $('correction-list').replaceChildren();$('employee-list').replaceChildren();
    $('timecard-summary').hidden=true;
   }
   $('employee-name').textContent=me.name;
   $('mode').textContent=me.mode==='gateway'?'Payroll integration':'Simulation only';
   $('app').hidden=false;
   $('admin').hidden=me.role!=='admin';
   $('connection').textContent='Signed in';
   const profile=await api('/attendance/profile');
   testLocationBypass=Boolean(profile.previewLocationBypass);
   $('supervisor-panel').hidden=!['admin','supervisor'].includes(profile.role);
   await Promise.all([loadSites(),history(),attendanceHistory(),notifications(),corrections(),...(me.role==='admin'?[employees()]:[])]);
   lastRefreshAt=Date.now();
   note(testLocationBypass?'PREVIEW TEST: LOCATION RESTRICTIONS DISABLED. All events are simulated; not valid for payroll.':me.mode==='gateway'?'Connected to the approved time-clock gateway.':'Simulation mode. Punches are not sent to ADP.',testLocationBypass?'error':'');
  }catch(e){
   if(['ACCESS_TOKEN_NOT_FORWARDED','ACCESS_TOKEN_INVALID_OR_EXPIRED','SIGN_IN_REQUIRED','ACCOUNT_NOT_PROVISIONED','ACCESS_CONFIGURATION_REQUIRED'].includes(e.message)){
    me=null;sites=[];testLocationBypass=false;
    $('app').hidden=true;
    $('admin').hidden=true;
    $('supervisor-panel').hidden=true;
    $('connection').textContent='Sign in required';
   }
   note('Access unavailable: '+e.message+'. Sign in through the approved Cloudflare Access application and ask your administrator to provision your employee account.','error');
  }
 })();
 try{await refreshing}finally{refreshing=null}
}
function resumeClock(){
 // Do not interrupt an attendance submission; its completion already refreshes activity.
 if(busy||document.visibilityState==='hidden'||Date.now()-lastRefreshAt<1000)return;
 refreshAccount();
}
window.addEventListener('irm-clock-resume',resumeClock);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeClock()});
window.addEventListener('pageshow',event=>{if(event.persisted)resumeClock()});

$('site').addEventListener('change',showSite);
$('radius').addEventListener('input',()=>{$('radius-output').textContent=$('radius').value+' feet'});
document.querySelectorAll('[data-attendance]').forEach(b=>b.addEventListener('click',()=>punch(b.dataset.attendance)));
$('refresh').addEventListener('click',()=>history().catch(e=>note(e.message,'error')));
$('site-form').addEventListener('submit',async e=>{
 e.preventDefault();const s=selected();if(!s)return note('Select an existing worksite. New site provisioning requires an approved admin operation.','error');
 try{await api('/admin/sites',{method:'POST',body:JSON.stringify({id:s.id,name:$('site-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),radiusFeet:Number($('radius').value),geofenceEnabled:$('geofence-enabled').checked})});await loadSites();note('Worksite settings saved. Future punch requests use the new geofence.','success')}catch(err){note(err.message,'error')}
});

async function attendanceHistory(){
 const {events}=await api('/attendance/events');
 $('attendance-history').innerHTML=events.length?events.slice(0,15).map(e=>'<div class="history-row"><div><strong>'+clean(e.event_type.replaceAll('_',' '))+'</strong><small>'+clean(new Date(e.occurred_at).toLocaleString())+'</small></div><span class="state">'+clean(e.provider_state)+'</span></div>').join(''):'<p class="hint">No attendance events recorded.</p>';
}
async function notifications(){
 const {items}=await api('/attendance/notifications');
 $('notifications-list').innerHTML=items.length?items.slice(0,20).map(x=>'<div class="history-row"><div><strong>'+clean(x.event_kind)+'</strong><small>'+clean(x.detail)+'</small></div><small>'+clean(new Date(x.created_at+'Z').toLocaleString())+'</small></div>').join(''):'<p class="hint">No notifications.</p>';
}
async function corrections(){
 const {requests}=await api('/attendance/requests');const panel=$('correction-list');
 const my=$('my-corrections');if(my)my.innerHTML=requests.filter(x=>x.employee_id===me.id).length?requests.filter(x=>x.employee_id===me.id).map(x=>'<div class="history-row"><div><strong>'+clean(x.event_type)+'</strong><small>'+clean(new Date(x.requested_at).toLocaleString())+'</small></div><span class="state">'+clean(x.status)+'</span></div>').join(''):'<p class="hint">No requests submitted.</p>';
 if(!panel)return;
 const review=me.role==='admin'||!$('supervisor-panel').hidden;
 panel.innerHTML=requests.length?requests.map(x=>'<div class="history-row"><div><strong>'+clean(x.display_name)+' — '+clean(x.event_type)+'</strong><small>'+clean(new Date(x.requested_at).toLocaleString())+' · '+clean(x.status)+'</small><small>'+clean(x.reason)+'</small></div>'+(review&&x.status==='PENDING'?'<div><button data-review="'+clean(x.id)+'" data-decision="APPROVED">Approve</button><button data-review="'+clean(x.id)+'" data-decision="REJECTED">Reject</button></div>':'')+'</div>').join(''):'<p class="hint">No correction requests.</p>';
 panel.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',async()=>{
  const reason=prompt('Required review reason (at least 5 characters):');if(!reason||reason.trim().length<5)return;
  button.disabled=true;
  try{await api('/attendance/review',{method:'POST',body:JSON.stringify({id:button.dataset.review,decision:button.dataset.decision,reason})});note('Correction review recorded; not submitted to payroll.','success');await Promise.all([corrections(),notifications()])}catch(e){note(e.message,'error')}finally{button.disabled=false}
 }));
}
$('attendance-refresh').addEventListener('click',()=>attendanceHistory().catch(e=>note(e.message,'error')));
$('notifications-refresh').addEventListener('click',()=>notifications().catch(e=>note(e.message,'error')));
$('timecard-refresh').addEventListener('click',async()=>{
 const now=Date.now(),to=new Date(now).toISOString(),from=new Date(now-7*86400000).toISOString();
 try{
  const x=await api('/attendance/timecard?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
  $('timecard-summary').hidden=false;
  const earnings=x.estimates.estimatedGrossCents===null?'Earnings estimate unavailable.':'Estimated gross USD '+(x.estimates.estimatedGrossCents/100).toFixed(2)+'.';
  $('timecard-summary').textContent='PRELIMINARY 7-day rolling window (not verified payroll week): '+x.totals.paidHours+' paid hours; unpaid lunch '+x.totals.unpaidLunchMinutes+' minutes; potential overtime '+(x.estimates.overtimeMinutes/60).toFixed(2)+' hours. '+earnings+' Not official ADP payroll.';
 }catch(e){note(e.message,'error')}
});
$('correction-form').addEventListener('submit',async e=>{
 e.preventDefault();const site=selected();if(!site)return note('No assigned worksite','error');
 const date=new Date($('correction-time').value);if(!Number.isFinite(date.getTime()))return note('Invalid correction date','error');
 const payload={type:$('correction-type').value,worksiteId:site.id,requestedAt:date.toISOString(),reason:$('correction-reason').value,source:'ONLINE',requestId:crypto.randomUUID()};
 try{await api('/attendance/requests',{method:'POST',body:JSON.stringify(payload)});e.target.reset();note('Correction submitted for supervisor review. No ADP punch was created.','success');await corrections()}catch(err){note(err.message,'error')}
});
$('schedule-form').addEventListener('submit',async e=>{
 e.preventDefault();const start=new Date($('schedule-start').value),end=new Date($('schedule-end').value);
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime()))return note('Invalid schedule dates','error');
 try{await api('/attendance/schedules',{method:'POST',body:JSON.stringify({employeeId:$('schedule-employee').value,startAt:start.toISOString(),endAt:end.toISOString()})});e.target.reset();note('Schedule recorded.','success')}catch(err){note(err.message,'error')}
});

async function employees(){
 const {employees:items}=await api('/attendance/admin/employees');
 $('employee-list').innerHTML=items.length?items.map(x=>'<div class="history-row"><div><strong>'+clean(x.display_name)+'</strong><small>'+clean(x.email||'No email')+' · '+clean(x.id)+'</small></div><span class="state">'+(x.active?'Active':'Inactive')+(x.is_supervisor?' · Supervisor':'')+'</span></div>').join(''):'<p class="hint">No employee records.</p>';
}
$('employee-refresh').addEventListener('click',()=>employees().catch(e=>note(e.message,'error')));
$('employee-form').addEventListener('submit',async e=>{
 e.preventDefault();const site=selected();if(!site)return note('Choose worksite first','error');
 try{const data=await api('/attendance/admin/employees',{method:'POST',body:JSON.stringify({name:$('employee-name-input').value,email:$('employee-email-input').value,role:$('employee-role-input').value,worksiteId:site.id})});e.target.reset();note('Employee staged INACTIVE ('+data.id+'). No invitation sent.','success');await employees()}catch(err){note(err.message,'error')}
});
$('assignment-form').addEventListener('submit',async e=>{
 e.preventDefault();
 try{await api('/attendance/admin/supervisor-assignment',{method:'POST',body:JSON.stringify({supervisorId:$('assignment-supervisor').value,employeeId:$('assignment-employee').value})});e.target.reset();note('Supervisor assignment saved.','success')}catch(err){note(err.message,'error')}
});
$('classification-form').addEventListener('submit',async e=>{
 e.preventDefault();
 try{await api('/attendance/admin/classification',{method:'POST',body:JSON.stringify({employeeId:$('classification-employee').value,classification:$('classification-type').value,effectiveAt:new Date().toISOString()})});note('Classification recorded with an effective date.','success')}catch(err){note(err.message,'error')}
});
$('pay-rate-form').addEventListener('submit',async e=>{
 e.preventDefault();const cents=Math.round(Number($('rate-hourly').value)*100);
 try{await api('/attendance/admin/rate',{method:'POST',body:JSON.stringify({employeeId:$('rate-employee').value,hourlyCents:cents,effectiveAt:new Date().toISOString()})});e.target.reset();note('Preview pay rate recorded with an effective date.','success')}catch(err){note(err.message,'error')}
});

function tick(){$('clock').textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}
tick();setInterval(tick,1000);refreshAccount();
