const $=id=>document.getElementById(id);let me=null,assignedSite=null,managedSites=[];let busy=false;let testLocationBypass=false;let refreshing=null;let lastRefreshAt=0;
let refreshAfterPunch=false;
const signInErrors=new Set(['ACCESS_LOGIN_REQUIRED','ACCESS_TOKEN_NOT_FORWARDED','ACCESS_TOKEN_INVALID_OR_EXPIRED','SIGN_IN_REQUIRED']);
const notificationToggle=$('notifications-toggle');
const notificationPanel=$('notifications-panel');
const alertsList=$('notifications-list');
const localAlerts=[];
const statusAlerts=new Map();
const pendingDeletions=new Map();
let nextAlertId=0;
let notificationRevision=0;
let serverAlerts=[];
let swipe=null;
const clean=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setUnread(unread){
 notificationToggle.toggleAttribute('data-unread',unread);
 notificationToggle.setAttribute('aria-label',unread?'Alerts, new messages':'Alerts');
}
function renderAlerts(){
 swipe=null;
 const alerts=[...localAlerts,...statusAlerts.values(),...serverAlerts].filter(alert=>!alert.dismissed).sort((a,b)=>b.receivedAt-a.receivedAt);
 alertsList.innerHTML=alerts.length?alerts.map(({id,title,message,type,receivedAt})=>
  '<div class="alert-swipe" data-alert-id="'+clean(id)+'"><span class="alert-swipe-action" aria-hidden="true">Delete</span>'+
  '<div class="alert-entry '+type+'"><div><strong>'+clean(title)+'</strong><p>'+clean(message)+'</p>'+
  '<time datetime="'+receivedAt.toISOString()+'">'+clean(receivedAt.toLocaleString())+'</time></div>'+
  '<button class="alert-delete" type="button" aria-label="Delete alert: '+clean(title)+'"'+(pendingDeletions.has(id)?' disabled':'')+'>'+
  '<span class="material-symbols-rounded" aria-hidden="true">close</span></button></div></div>'
 ).join(''):'<p class="hint">No alerts.</p>';
}
function announceAlert(message){
 $('notice').textContent=message;
 if(notificationPanel.hidden)setUnread(true);
 renderAlerts();
}
function note(message,type='info'){
 const title={info:'Update',success:'Success',error:'Error'}[type];
 localAlerts.unshift({id:'local:'+nextAlertId++,title,message,type,receivedAt:new Date()});
 if(localAlerts.length>30)localAlerts.pop();
 announceAlert(message);
}
function setStatusAlert(key,title,message,type='warning'){
 if(!message){
  if(statusAlerts.delete(key))renderAlerts();
 }else if(statusAlerts.get(key)?.message!==message){
  statusAlerts.set(key,{id:'status:'+key,title,message,type,receivedAt:new Date()});
  announceAlert(message);
 }
}
async function api(path,options={}){
 // Access may redirect an expired API session to a cross-origin login page. Open
 // login as a document navigation so it can set cookies in this browser session.
 const res=await fetch('/api'+path,{...options,cache:'no-store',credentials:'same-origin',redirect:'manual',headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest',...options.headers}});
 if(res.type==='opaqueredirect'||res.redirected||(res.status>=300&&res.status<400))throw Error('ACCESS_LOGIN_REQUIRED');
 if(res.status===401&&!res.headers.get('content-type')?.includes('application/json'))throw Error('ACCESS_LOGIN_REQUIRED');
 if(res.status===403&&!res.headers.get('content-type')?.includes('application/json'))throw Error('ACCESS_POLICY_DENIED');
 let json;try{json=await res.json()}catch{throw Error('Invalid server response')}
 if(!res.ok)throw Error(json.error||'Request failed');
 return json;
}
function fillOptions(select,items,label,placeholder){
 const previous=select.value;
 select.replaceChildren(new Option(placeholder,''),...items.map(item=>new Option(item[label],item.id)));
 if(items.some(item=>item.id===previous))select.value=previous;
}
function showManagedSite(){
 const site=managedSites.find(item=>item.id===$('managed-site').value);
 $('site-name').value=site?.name??'';
 $('latitude').value=site?.latitude??'';
 $('longitude').value=site?.longitude??'';
 $('radius').value=site?.radius_feet??500;
 $('radius-output').textContent=$('radius').value+' feet';
 $('geofence-enabled').checked=Boolean(site?.geofence_enabled);
}
async function loadSites(){
 const account=me;
 const {sites}=await api('/sites');
 if(me!==account)return;
 assignedSite=sites[0]??null;
 $('site').textContent=assignedSite?.name??'No worksite assigned';
}
async function loadManagedSites(){
 const account=me;
 const {sites}=await api('/admin/sites');
 if(me!==account)return;
 managedSites=sites;
 fillOptions($('managed-site'),sites,'name','Choose a worksite');
 fillOptions($('worksite-assignment'),sites,'name','Choose a worksite');
 showManagedSite();
}
function getLocation(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(Error('This device does not support location verification.'));
  navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracyMeters:p.coords.accuracy,capturedAt:p.timestamp}),e=>reject(Error(e.code===1?'Location permission is required. Enable location access and retry.':'Could not verify a current location. Move into open space and retry.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 });
}
async function punch(type){
 if(busy)return;const site=assignedSite;if(!site)return note('No worksite is assigned to your account. Contact the owner.','error');
 busy=true;document.querySelectorAll('[data-attendance]').forEach(b=>b.disabled=true);
 const requestId=crypto.randomUUID();
 try{
  note('Submitting '+type.toLowerCase().replaceAll('_',' ')+'…');
  const location=site.geofence_enabled&&!testLocationBypass?await getLocation():null;
  const {event:p}=await api('/attendance/events',{method:'POST',body:JSON.stringify({type,worksiteId:site.id,requestId,location})});
  note(p.provider_state==='CONFIRMED'?'Punch confirmed by the connected provider.':p.provider_state==='SIMULATED'?'Attendance event saved in SIMULATION. Not sent to ADP.':'Punch status: '+p.provider_state+'. '+(p.provider_message||'Check status before retrying.'),p.provider_state==='UNKNOWN'?'error':'success');
  await attendanceHistory();
 }catch(e){
  if(signInErrors.has(e.message)||e.message==='ACCOUNT_NOT_PROVISIONED')showAccountError(e);
  else note(e.message,'error');
 }finally{
  busy=false;
  document.querySelectorAll('[data-attendance]').forEach(b=>b.disabled=false);
  if(refreshAfterPunch){refreshAfterPunch=false;refreshAccount()}
 }
}
function clearAccountDetails(){
 $('greeting-name').textContent='User!';
 assignedSite=null;managedSites=[];testLocationBypass=false;
 $('site').textContent='No worksite assigned';
 for(const id of ['managed-site','worksite-employee','worksite-assignment','employee-name','attendance-history','my-corrections','correction-list','employee-list','timecard-summary'])$(id).replaceChildren();
 localAlerts.length=0;serverAlerts=[];statusAlerts.clear();
 pendingDeletions.clear();notificationRevision++;
 $('notice').textContent='';
 setUnread(false);renderAlerts();
 $('timecard-summary').hidden=true;
 for(const form of $('app').querySelectorAll('form'))form.reset();
}
function showAccountError(error){
 const code=error.message;
 const signIn=signInErrors.has(code);
 const unprovisioned=code==='ACCOUNT_NOT_PROVISIONED';
 me=null;
 $('app').hidden=true;
 $('notifications-refresh').hidden=true;
 closeNotifications();
 $('admin').hidden=true;
 $('supervisor-panel').hidden=true;
 clearAccountDetails();
 $('sign-in').hidden=!signIn;
 $('retry-account').hidden=false;
 $('connection').textContent=signIn?'Sign in required':unprovisioned?'Account inactive':'Connection unavailable';
 const message={
  ACCESS_LOGIN_REQUIRED:'Your Cloudflare Access session needs to be renewed. Open sign-in to continue.',
  ACCESS_TOKEN_NOT_FORWARDED:'The Worker received no Cloudflare Access credential. Open sign-in. If this repeats, ask your administrator to check Access protection for this hostname and its API.',
  ACCESS_TOKEN_INVALID_OR_EXPIRED:'The Worker could not verify the Cloudflare Access session. Open sign-in. If this repeats, ask your administrator to check the Access issuer and application audience.',
  SIGN_IN_REQUIRED:'Open sign-in to connect to the Cloudflare Access session.',
  ACCESS_POLICY_DENIED:'Access denied this request. Ask your administrator to check the Cloudflare Access policy for the Time Clock API.',
  ACCOUNT_NOT_PROVISIONED:'Cloudflare Access sign-in succeeded. Ask your administrator to activate the Time Clock employee record for this identity.',
  ACCESS_CONFIGURATION_REQUIRED:'The Time Clock Worker needs its Cloudflare Access issuer and application audience configured.',
  ACCESS_VERIFICATION_UNAVAILABLE:'The Worker could not reach the Cloudflare Access signing keys. Retry the connection.'
 }[code]||'Time Clock could not refresh your account. Retry the connection.';
 note(message+' ('+code+')','error');
}
async function refreshAccount(){
 if(refreshing)return refreshing;
 $('app').inert=true;
 refreshing=(async()=>{
  try{
   const account=await api('/me');
   if(me&&(me.id!==account.id||me.role!==account.role||me.canManageWorksites!==account.canManageWorksites)){
    $('app').hidden=true;
    clearAccountDetails();
   }
   me=account;
   const profile=await api('/attendance/profile');
   testLocationBypass=Boolean(profile.previewLocationBypass);
   setStatusAlert('preview','Preview test',testLocationBypass?
    'Location restrictions are disabled. All events are simulated and cannot be used for payroll.':'');
   $('supervisor-panel').hidden=!['admin','supervisor'].includes(profile.role);
   const [worksites,...activity]=await Promise.allSettled([
    loadSites(),attendanceHistory(),notifications(),corrections(),
    ...(me.role==='admin'?[employees()]:[]),...(me.canManageWorksites?[loadManagedSites()]:[]),
    ...($('timecard-summary').hidden?[]:[loadTimecard()])
   ]);
   const sessionFailure=activity.find(result=>result.status==='rejected'&&
    (signInErrors.has(result.reason.message)||result.reason.message==='ACCOUNT_NOT_PROVISIONED'));
   if(sessionFailure)throw sessionFailure.reason;
   if(worksites.status==='rejected')throw worksites.reason;
   $('employee-name').textContent=me.name;
   $('greeting-name').textContent=(String(me.name||'').trim().split(/\s+/)[0]||'User')+'!';
   updateGreeting();
   $('mode').textContent=me.mode==='gateway'?'Payroll integration':'Simulation only';
   $('admin').hidden=me.role!=='admin';
   $('worksite-settings').hidden=!me.canManageWorksites;
   $('notifications-refresh').hidden=false;
   $('app').hidden=false;
   $('sign-in').hidden=true;
   $('connection').textContent='Signed in';
   lastRefreshAt=Date.now();
   const incomplete=activity.some(result=>result.status==='rejected');
   $('retry-account').hidden=!incomplete;
   if(incomplete){note('Signed in. Some attendance details could not refresh. Retry the connection.','error');return}
  }catch(e){
   showAccountError(e);
  }
 })();
 try{await refreshing}finally{refreshing=null;$('app').inert=false}
}
function resumeClock(){
 if(document.visibilityState==='hidden')return;
 if(busy){refreshAfterPunch=true;return}
 if(Date.now()-lastRefreshAt<1000)return;
 refreshAccount();
}
$('sign-in').addEventListener('click',()=>window.location.reload());
$('retry-account').addEventListener('click',()=>refreshAccount());
window.addEventListener('irm-clock-resume',resumeClock);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeClock()});
window.addEventListener('pageshow',event=>{if(event.persisted)resumeClock()});

$('managed-site').addEventListener('change',showManagedSite);
$('radius').addEventListener('input',()=>{$('radius-output').textContent=$('radius').value+' feet'});
document.querySelectorAll('[data-attendance]').forEach(b=>b.addEventListener('click',()=>punch(b.dataset.attendance)));
$('site-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const id=$('managed-site').value;
 try{await api('/admin/sites',{method:'POST',body:JSON.stringify({id,name:$('site-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),radiusFeet:Number($('radius').value),geofenceEnabled:$('geofence-enabled').checked})});await Promise.all([loadSites(),loadManagedSites()]);note('Worksite settings saved. Future punch requests use the new geofence.','success')}catch(err){note(err.message,'error')}
});
$('worksite-assignment-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const employeeId=$('worksite-employee').value,worksiteId=$('worksite-assignment').value;
 try{
  await api('/admin/assignments',{method:'PUT',body:JSON.stringify({employeeId,worksiteId})});
  if(employeeId===me?.id)await loadSites();
  e.target.reset();
  note('Assigned worksite updated.','success');
 }catch(err){note(err.message,'error')}
});

async function attendanceHistory(){
 const {events}=await api('/attendance/events');
 $('attendance-history').innerHTML=events.length?events.slice(0,15).map(e=>'<div class="history-row"><div><strong>'+clean(e.event_type.replaceAll('_',' '))+'</strong><small>'+clean(new Date(e.occurred_at).toLocaleString())+'</small></div><span class="state">'+clean(e.provider_state)+'</span></div>').join(''):'<p class="hint">No attendance events recorded.</p>';
}
async function notifications(){
 const account=me;
 const revision=++notificationRevision;
 const {items}=await api('/attendance/notifications');
 if(me!==account||revision!==notificationRevision)return;
 const previous=new Set(serverAlerts.map(alert=>alert.id));
 serverAlerts=items.slice(0,20).map(item=>{
  const timestamp=item.created_at.replace(' ','T');
  const receivedAt=new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(timestamp)?timestamp:timestamp+'Z');
  return {id:'server:'+item.id,notificationId:item.id,title:item.event_kind,message:item.detail,type:'info',receivedAt};
 }).filter(alert=>Number.isFinite(alert.receivedAt.getTime()));
 if(serverAlerts.some(alert=>!previous.has(alert.id))&&notificationPanel.hidden)setUnread(true);
 renderAlerts();
}
async function deleteAlert(id,restoreFocus){
 const serverAlert=serverAlerts.find(alert=>alert.id===id);
 if(serverAlert){
  if(pendingDeletions.has(id))return;
  const deletion=Symbol();
  pendingDeletions.set(id,deletion);
  renderAlerts();
  try{
   await api('/attendance/notifications/'+encodeURIComponent(serverAlert.notificationId),{method:'DELETE'});
   if(pendingDeletions.get(id)!==deletion)return;
   notificationRevision++;
   serverAlerts=serverAlerts.filter(alert=>alert.id!==id);
  }catch(error){
   if(pendingDeletions.get(id)!==deletion)return;
   note(error.message,'error');
  }
  pendingDeletions.delete(id);
 }else{
  const index=localAlerts.findIndex(alert=>alert.id===id);
  if(index!==-1)localAlerts.splice(index,1);
  for(const alert of statusAlerts.values())if(alert.id===id)alert.dismissed=true;
 }
 renderAlerts();
 if(restoreFocus&&!notificationPanel.hidden)(alertsList.querySelector('.alert-delete')??notificationToggle).focus();
}

alertsList.addEventListener('click',event=>{
 const button=event.target.closest('.alert-delete');
 if(button)deleteAlert(button.closest('.alert-swipe').dataset.alertId,event.detail===0);
});
alertsList.addEventListener('pointerdown',event=>{
 const row=event.target.closest('.alert-swipe');
 if(swipe||!row||!event.isPrimary||event.button!==0||event.target.closest('button'))return;
 swipe={row,pointerId:event.pointerId,x:event.clientX,y:event.clientY};
 row.setPointerCapture(event.pointerId);
});
alertsList.addEventListener('pointermove',event=>{
 if(!swipe||swipe.pointerId!==event.pointerId)return;
 const left=swipe.x-event.clientX,vertical=Math.abs(swipe.y-event.clientY);
 if(!swipe.row.classList.contains('dragging')){
  if(vertical>8&&vertical>=Math.abs(left)){finishSwipe(event,false);return}
  if(left<=8||left<=vertical)return;
  swipe.row.classList.add('dragging');
 }
 swipe.row.querySelector('.alert-entry').style.transform='translateX('+-Math.max(0,left)+'px)';
});
function finishSwipe(event,release){
 if(!swipe||swipe.pointerId!==event.pointerId)return;
 const {row,x,y}=swipe;
 swipe=null;
 const left=x-event.clientX;
 const width=row.getBoundingClientRect().width;
 const shouldDelete=release&&width>0&&left>Math.abs(y-event.clientY)&&left>width*.3;
 row.classList.remove('dragging');
 row.querySelector('.alert-entry').style.transform='';
 if(shouldDelete)deleteAlert(row.dataset.alertId,false);
}
alertsList.addEventListener('pointerup',event=>finishSwipe(event,true));
alertsList.addEventListener('pointercancel',event=>finishSwipe(event,false));
alertsList.addEventListener('lostpointercapture',event=>finishSwipe(event,false));
async function corrections(){
 const {requests}=await api('/attendance/requests');const panel=$('correction-list');
 if(!me)return;
 const my=$('my-corrections');if(my)my.innerHTML=requests.filter(x=>x.employee_id===me.id).length?requests.filter(x=>x.employee_id===me.id).map(x=>'<div class="history-row"><div><strong>'+clean(x.event_type)+'</strong><small>'+clean(new Date(x.requested_at).toLocaleString())+'</small></div><span class="state">'+clean(x.status)+'</span></div>').join(''):'<p class="hint">No requests submitted.</p>';
 if(!panel)return;
 const review=me.role==='admin'||!$('supervisor-panel').hidden;
 panel.innerHTML=requests.length?requests.map(x=>'<div class="history-row"><div><strong>'+clean(x.display_name)+' — '+clean(x.event_type)+'</strong><small>'+clean(new Date(x.requested_at).toLocaleString())+' · '+clean(x.status)+'</small><small>'+clean(x.reason)+'</small></div>'+(review&&x.status==='PENDING'?'<div><button data-review="'+clean(x.id)+'" data-decision="APPROVED">Approve</button><button data-review="'+clean(x.id)+'" data-decision="REJECTED">Reject</button></div>':'')+'</div>').join(''):'<p class="hint">No correction requests.</p>';
 panel.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',async()=>{
  const reason=prompt('Required review reason (at least 5 characters):');if(reason===null)return;
  if(reason.trim().length<5)return note('Enter a review reason with at least 5 characters.','error');
  button.disabled=true;
  try{await api('/attendance/review',{method:'POST',body:JSON.stringify({id:button.dataset.review,decision:button.dataset.decision,reason})});note('Correction review recorded; not submitted to payroll.','success');await Promise.all([corrections(),notifications()])}catch(e){note(e.message,'error')}finally{button.disabled=false}
 }));
}
$('attendance-refresh').addEventListener('click',()=>Promise.all([attendanceHistory(),loadTimecard()]).catch(e=>note(e.message,'error')));
$('notifications-refresh').addEventListener('click',()=>notifications().catch(e=>note(e.message,'error')));
// Biweekly Sunday-Saturday pay periods, anchored to Nov 8-21, 2026.
// Indianapolis local midnight boundaries account for daylight saving transitions.
const DAY=86400000;
const PAY_ANCHOR=Date.UTC(2026,10,8);
function localDateParts(date){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date);
 const v=type=>Number(parts.find(p=>p.type===type).value);
 return {year:v('year'),month:v('month'),day:v('day')};
}
function easternMidnight(day){
 const midday=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),12));
 const value=new Intl.DateTimeFormat('en-US',{timeZone:'America/Indiana/Indianapolis',timeZoneName:'shortOffset'}).formatToParts(midday).find(p=>p.type==='timeZoneName')?.value||'';
 const m=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value);
 if(!m)throw Error('Unable to resolve Indianapolis timezone offset');
 const minutes=(m[1]==='+'?1:-1)*(Number(m[2])*60+Number(m[3]||0));
 return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate())-minutes*60000);
}
function currentPayPeriod(now=new Date()){
 const p=localDateParts(now);
 const today=Date.UTC(p.year,p.month-1,p.day);
 const index=Math.floor((today-PAY_ANCHOR)/(14*DAY));
 const startDay=new Date(PAY_ANCHOR+index*14*DAY);
 const endDay=new Date(PAY_ANCHOR+(index+1)*14*DAY);
 const paydayDay=new Date(Date.UTC(2026,10,27)+index*14*DAY);
 const labelDay=date=>date.toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
 return {from:easternMidnight(startDay).toISOString(),to:easternMidnight(endDay).toISOString(),
  label:labelDay(startDay)+' – '+labelDay(new Date(endDay.getTime()-DAY))+', '+startDay.getUTCFullYear(),
  payday:paydayDay.toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'})};
}
async function loadTimecard(){
 const account=me;
 const period=currentPayPeriod();
 $('pay-period-label').textContent=period.label;
 $('payday-label').textContent='Scheduled payday: '+period.payday;
 const x=await api('/attendance/timecard?from='+encodeURIComponent(period.from)+'&to='+encodeURIComponent(period.to));
 if(me!==account)return;
 const hours=x.totals.paidHours.toFixed(2);
 const lunch=(x.totals.unpaidLunchMinutes/60).toFixed(2);
 const overtime=(x.estimates.overtimeMinutes/60).toFixed(2);
 const summary=$('timecard-summary');summary.hidden=false;summary.replaceChildren();
 const metrics=[['Paid hours',hours],['Unpaid lunch',lunch+' hr'],['Potential overtime',overtime+' hr']];
 for(const [label,value] of metrics){
  const card=document.createElement('div');card.className='metric';
  const title=document.createElement('span');title.className='metric-label';title.textContent=label;
  const amount=document.createElement('strong');amount.textContent=value;
  card.append(title,amount);summary.append(card);
 }
 setStatusAlert('incomplete-shift','Timecard',x.totals.incompleteShift?'An incomplete shift requires review.':'');
}
$('correction-form').addEventListener('submit',async e=>{
 e.preventDefault();const site=assignedSite;if(!site)return note('No worksite assigned.','error');
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
 const account=me;
 const {employees:items}=await api('/attendance/admin/employees');
 if(me!==account)return;
 if(me?.canManageWorksites)fillOptions($('worksite-employee'),items,'display_name','Choose an employee');
 $('employee-list').innerHTML=items.length?items.map(x=>'<div class="history-row"><div><strong>'+clean(x.display_name)+'</strong><small>'+clean(x.email||'No email')+' · '+clean(x.id)+'</small></div><span class="state">'+(x.active?'Active':'Inactive')+(x.is_supervisor?' · Supervisor':'')+'</span></div>').join(''):'<p class="hint">No employee records.</p>';
}
$('employee-refresh').addEventListener('click',()=>employees().catch(e=>note(e.message,'error')));
$('employee-form').addEventListener('submit',async e=>{
 e.preventDefault();const site=assignedSite;if(!site)return note('No worksite assigned.','error');
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

function updateGreeting(){
 const hour=new Date().getHours();
 $('greeting-time').textContent=hour<12?'Good Morning,':hour<17?'Good Afternoon,':'Good Evening,';
}
function tick(){$('clock').textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});updateGreeting()}
const requestTabs=$('request-tabs');
const requestTabButtons=[...requestTabs.querySelectorAll('[role="tab"]')];
function selectRequestTab(selected){
 for(const tab of requestTabButtons){
  const active=tab===selected;
  tab.setAttribute('aria-selected',String(active));
  tab.tabIndex=active?0:-1;
  $(tab.getAttribute('aria-controls')).hidden=!active;
 }
}
for(const tab of requestTabButtons)tab.addEventListener('click',()=>selectRequestTab(tab));
requestTabs.addEventListener('keydown',event=>{
 const index=requestTabButtons.indexOf(event.target);
 if(index===-1)return;
 const last=requestTabButtons.length-1;
 const target={
  ArrowLeft:index===0?last:index-1,
  ArrowRight:index===last?0:index+1,
  Home:0,
  End:last
 }[event.key];
 if(target===undefined)return;
 event.preventDefault();
 const tab=requestTabButtons[target];
 selectRequestTab(tab);
 tab.focus();
});

function closeNotifications(){
 notificationPanel.hidden=true;
 notificationToggle.setAttribute('aria-expanded','false');
}
notificationToggle.addEventListener('click',async()=>{
 const opening=notificationPanel.hidden;
 notificationPanel.hidden=!opening;
 notificationToggle.setAttribute('aria-expanded',String(opening));
 if(opening){
  setUnread(false);
  renderAlerts();
  if(me)notifications().catch(e=>note(e.message,'error'));
 }
});
document.addEventListener('click',event=>{
 if(!notificationPanel.hidden&&!notificationPanel.contains(event.target)&&!notificationToggle.contains(event.target))closeNotifications();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeNotifications()});
$('app').addEventListener('invalid',event=>{
 const field=event.target;
 event.preventDefault();
 if(field!==field.form?.querySelector('input:invalid,select:invalid'))return;
 const label=field.labels[0]?.textContent;
 note(label?label+': '+field.validationMessage:field.validationMessage,'error');
 field.focus();
},true);
const screens=['clock','recent','timecard','settings'];
let currentScreen='clock',lastMainScreen='clock';
function showScreen(name){
 if(!screens.includes(name))return;
 closeNotifications();
 if(name==='settings'){
  lastMainScreen=currentScreen==='settings'?lastMainScreen:currentScreen;
 }else{lastMainScreen=name}
 currentScreen=name;
 screens.forEach(screen=>{$(screen+'-screen').hidden=screen!==name});
 $('screen-title').textContent={clock:'Clock',recent:'Request',timecard:'Timecard',settings:'Settings'}[name];
 $('settings-toggle').setAttribute('aria-expanded',String(name==='settings'));
 $('settings-toggle').setAttribute('aria-label',name==='settings'?'Return to '+lastMainScreen:'Open settings');
 document.querySelectorAll('[data-screen]').forEach(button=>{
  const active=button.dataset.screen===name;
  button.classList.toggle('active',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
 if(name==='timecard'&&me&&!refreshing)loadTimecard().catch(e=>note(e.message,'error'));
 window.scrollTo({top:0,behavior:'instant'});
}
$('settings-toggle').addEventListener('click',()=>showScreen(currentScreen==='settings'?lastMainScreen:'settings'));
$('settings-refresh').addEventListener('click',()=>refreshAccount());
document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>showScreen(button.dataset.screen)));
tick();setInterval(tick,1000);refreshAccount();
