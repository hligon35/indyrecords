const $=id=>document.getElementById(id);let me=null,sites=[];let busy=false;
const note=(message,type='')=>{$('notice').textContent=message;$('notice').className='notice '+type;};
const clean=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){
 const res=await fetch('/api'+path,{...options,credentials:'same-origin',headers:{'content-type':'application/json',...options.headers}});
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
 $('history').innerHTML=punches.length?punches.map(p=>'<div class="history-row"><div><strong>'+clean(p.type.replace('_',' '))+'</strong><small>'+clean(new Date(p.submitted_at).toLocaleString())+'</small></div><span class="state">'+clean(p.provider_state)+'</span></div>').join(''):'<p class="hint">No punches have been submitted.</p>';
}
function getLocation(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(Error('This device does not support location verification.'));
  navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracyMeters:p.coords.accuracy,capturedAt:p.timestamp}),e=>reject(Error(e.code===1?'Location permission is required. Enable location access and retry.':'Could not verify a current location. Move into open space and retry.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 });
}
async function punch(type){
 if(busy)return;const site=selected();if(!site)return note('No worksite is assigned to your account. Contact an administrator.','error');
 busy=true;document.querySelectorAll('[data-punch]').forEach(b=>b.disabled=true);
 const requestId=crypto.randomUUID();
 try{
  note('Checking location and submitting '+type.toLowerCase().replace('_',' ')+'…');
  const location=site.geofence_enabled?await getLocation():null;
  const {punch:p}=await api('/punches',{method:'POST',body:JSON.stringify({type,worksiteId:site.id,requestId,location})});
  note(p.provider_state==='CONFIRMED'?'Punch confirmed by the connected provider.':p.provider_state==='SIMULATED'?'Simulated punch saved. This is NOT a payroll clock punch.':'Punch status: '+p.provider_state+'. '+(p.provider_message||'Check status before retrying.'),p.provider_state==='UNKNOWN'?'error':'success');
  await history();
 }catch(e){note(e.message,'error')}finally{busy=false;document.querySelectorAll('[data-punch]').forEach(b=>b.disabled=false)}
}
async function boot(){
 try{
  me=await api('/me');$('employee-name').textContent=me.name;$('mode').textContent=me.mode==='gateway'?'Payroll integration':'Simulation only';
  $('app').hidden=false;$('admin').hidden=me.role!=='admin';$('connection').textContent='Signed in';
  await Promise.all([loadSites(),history()]);
  note(me.mode==='gateway'?'Connected to the approved time-clock gateway.':'Simulation mode. Punches are not sent to ADP.');
 }catch(e){note('Access unavailable: '+e.message+'. Sign in through the approved Cloudflare Access application and ask your administrator to provision your employee account.','error')}
}
$('site').addEventListener('change',showSite);
$('radius').addEventListener('input',()=>{$('radius-output').textContent=$('radius').value+' feet'});
document.querySelectorAll('[data-punch]').forEach(b=>b.addEventListener('click',()=>punch(b.dataset.punch)));
$('refresh').addEventListener('click',()=>history().catch(e=>note(e.message,'error')));
$('site-form').addEventListener('submit',async e=>{
 e.preventDefault();const s=selected();if(!s)return note('Select an existing worksite. New site provisioning requires an approved admin operation.','error');
 try{await api('/admin/sites',{method:'POST',body:JSON.stringify({id:s.id,name:$('site-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),radiusFeet:Number($('radius').value),geofenceEnabled:$('geofence-enabled').checked})});await loadSites();note('Worksite settings saved. Future punch requests use the new geofence.','success')}catch(err){note(err.message,'error')}
});
function tick(){$('clock').textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}
tick();setInterval(tick,1000);boot();
