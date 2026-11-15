import React,{useEffect,useRef,useState} from 'react';
import {View,AppState} from 'react-native';
import {Text,TextInput,Pressable,compactStyles} from './components/CompactUI.js';
import {createApiClient,ApiError} from '../../packages/api-client/index.js';
import {createSyncCoordinator} from '../../packages/api-client/sync.js';
import {workflowRepository,loadWorkspace,stageCommand,cacheWorkspace,syntheticWorkflowReceiver} from './storage/warehouse-store.js';
import {subscribeScanner} from './scanner.js';
import {warehouseStore} from './storage/warehouse-store.js';
import {accountSession} from './account-session.js';
import {useAccount} from './AccountProvider.js';
import {can} from '../../packages/security/permissions.js';
import {COMMAND_PERMISSIONS} from '../../packages/warehouse/workflows.js';
const button=compactStyles.button;
export default function WarehousePanel({active=true}){
 const account=useAccount();
 const [workspace,setWorkspace]=useState(null),[queue,setQueue]=useState([]),[barcode,setBarcode]=useState('IRM-BX-1002'),[operation,setOperation]=useState('Retrieval'),[notice,setNotice]=useState('On-device sample workspace.'),[principal,setPrincipal]=useState(null),[conflict,setConflict]=useState(null),[busy,setBusy]=useState(false),[inputMode,setInputMode]=useState('keyboard'),[customerId,setCustomerId]=useState('c2');
 const lock=useRef(false),current=useRef(null),sync=useRef(null),scanHandler=useRef(null);
 const actorId=principal?.user.id||'local-demo-manager';
 const repository={read:()=>workflowRepository(actorId,customerId).read(),write:queue=>workflowRepository(actorId,customerId).write(queue)};
 const api=()=>{const s=accountSession.current;if(!s)throw Error('Sign in through Approved account first');return createApiClient({baseUrl:s.baseUrl,getAccessToken:()=>s.accessToken,readOnly:false})};
 useEffect(()=>{setPrincipal(null);setWorkspace(null);setQueue([]);setConflict(null);setInputMode('keyboard')},[account?.accessToken,account?.user?.id,account?.user?.role,JSON.stringify(account?.customerIds),account?.expiresAt,account?.baseUrl]);
 current.current={actorId,customerId,principal};
 async function reload(){setWorkspace(await loadWorkspace(actorId,customerId));setQueue(await repository.read())}
 useEffect(()=>{let active=true;setWorkspace(null);setQueue([]);Promise.all([loadWorkspace(actorId,customerId),repository.read()]).then(([state,events])=>{if(active){setWorkspace(state);setQueue(events)}}).catch(error=>{if(active)setNotice(error.message)});return ()=>{active=false}},[actorId,customerId]);
 useEffect(()=>{
  if(!active||inputMode!=='intent')return;
  const subscription=subscribeScanner(value=>{setBarcode(value);scanHandler.current?.(value)});
  if(!subscription.available)setNotice('Native intent input requires a development APK. Keyboard input remains available.');
  return ()=>subscription.remove();
 },[inputMode,active]);
 async function perform(command,replaces=null){
  if(principal&&!can({id:principal.user.id,role:principal.user.role,active:true,customerIds:principal.customerIds},COMMAND_PERMISSIONS[command.type],{customerId})){setNotice('Your account does not have permission for this warehouse action.');return}
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const next=await stageCommand(actorId,customerId,{...command,clientEventId:globalThis.crypto?.randomUUID?.()||'demo-'+Date.now()+'-'+Math.random().toString(36).slice(2)},replaces);setWorkspace(next);setQueue(await repository.read());setNotice('Saved offline. Awaiting '+(principal?'local D1':'on-device simulator')+' acknowledgement.')}catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}
 }
 useEffect(()=>{if(!active)setInputMode('keyboard')},[active]);
 function scan(value=barcode){
  if(!active)return;
  const code=value.trim().toUpperCase(),record=workspace?.records.find(x=>x.barcode===code);
  if(!record){setNotice('Barcode not in this customer’s sample inventory.');return}
  const order=workspace.orders.find(x=>!['delivered','cancelled','closed'].includes(x.status)&&x.items.some(i=>i.barcode===code));
  if(!order){setNotice('Create a work order for this record first.');return}
  const item=order.items.find(x=>x.barcode===code);
  const type=item.status==='pending'?(order.direction==='inbound'?'receive':'pick'):['picked','received'].includes(item.status)?'stage':order.direction==='inbound'&&item.status==='staged'?'refile':null;
  if(!type){setNotice('No scan action available; dispatch or deliver this order.');return}
  perform({type,barcode:code,expectedVersion:record.version,orderId:order.id,orderVersion:order.version,...(type==='receive'?{location:'RECEIVING'}:type==='stage'?{location:'STAGE-01'}:type==='refile'?{location:'A01-R01'}:{})});
 }
 scanHandler.current=scan;
 async function synchronize(){
  if(lock.current)return;lock.current=true;setBusy(true);
  const owner=actorId;
  try{
   const receiver=principal?{async submitScan(event){if(event.actorId!==owner||!principal.customerIds.includes(event.customerId))throw new ApiError('Queue belongs to a different user/customer',403);return api().submitWarehouseCommand(event.customerId,event.command)}}:syntheticWorkflowReceiver();
   sync.current=createSyncCoordinator({repository,api:receiver});const result=await sync.current.synchronize();
   if(result.status==='auth-required'){await accountSession.clear();setPrincipal(null);setWorkspace(null);setQueue([]);setNotice('Session expired. Protected queue is retained.');return}
   if(principal&&!(await repository.read()).some(e=>['pending','sending'].includes(e.status))){const fresh=await api().getWorkspace(customerId);await cacheWorkspace(owner,customerId,{...fresh,receipts:[]})}
   await reload();setNotice('Queue processed against '+(principal?'local D1.':'on-device simulator.'));
  }catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}
 }
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state!=='active')setInputMode('keyboard');if(state==='active'&&active&&sync.current&&!lock.current)synchronize()});return ()=>listener.remove()},[actorId,customerId,account?.accessToken,active]);
 async function connect(){if(lock.current)return;lock.current=true;setBusy(true);try{const cached=accountSession.current;if(cached?.offline){await warehouseStore.unlockScope(cached,customerId);setPrincipal(cached);setNotice('Existing protected warehouse queue resumed offline until original session expiry.');return}const user=await accountSession.verifyCurrent();const granted=user.customerIds.filter(x=>['c1','c2','c3','c4'].includes(x));if(!granted.length)throw Error('No customer access has been assigned to this account.');const target=granted.includes(customerId)?customerId:granted[0];const state=await api().getWorkspace(target);await warehouseStore.unlockScope(user,target);const pending=await workflowRepository(user.user.id,target).read();if(!pending.some(e=>['pending','sending'].includes(e.status)))await cacheWorkspace(user.user.id,target,{...state,receipts:[]});setCustomerId(target);setPrincipal(user);setNotice('Approved account connected with protected offline storage.')}catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}}
 async function selectCustomer(id){if(lock.current)return;if(!principal){setCustomerId(id);return}lock.current=true;setBusy(true);try{await warehouseStore.unlockScope(accountSession.current,id);const pending=await workflowRepository(actorId,id).read();if(!pending.some(e=>['pending','sending'].includes(e.status)))await cacheWorkspace(actorId,id,{...await api().getWorkspace(id),receipts:[]});setCustomerId(id)}catch(e){setNotice(e.message)}finally{lock.current=false;setBusy(false)}}
 async function refreshConflict(event){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{if(!principal)throw Error('For local simulator conflicts, inspect the action and keep the original event for review.');const state=await api().getWorkspace(customerId);await cacheWorkspace(actorId,customerId,{...state,receipts:[]});setWorkspace(state);setConflict(event);setNotice('Fresh server state loaded. Review the rejected action before creating a replacement.')}catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}
 }
 async function rebuild(){if(!conflict||!workspace)return;const c={...conflict.command};delete c.clientEventId;const r=workspace.records.find(x=>x.barcode===c.barcode),o=workspace.orders.find(x=>x.id===c.orderId);if(r)c.expectedVersion=r.version;if(o)c.orderVersion=o.version;setConflict(null);await perform(c,conflict.clientEventId)}
 const press=(label,onPress)=><Pressable disabled={busy} accessibilityRole="button" onPress={onPress} style={button}><Text style={{color:'white',fontWeight:'700'}}>{label}</Text></Pressable>;
 if(principal&&(!account||account.user.id!==principal.user.id))return <View><Text>Locking previous account workspace.</Text></View>;
 return <View style={{...compactStyles.panel}}><Text style={{...compactStyles.heading}}>Warehouse workflows · {customerId}</Text><Text>Sample records · {principal?'Verified local D1':'On-device simulator'}</Text><Text>Use the Account tab to sign in before connecting.</Text>{press('Connect approved warehouse account',connect)}{principal&&press('Return to sample workspace',()=>{if(lock.current)return;warehouseStore.lockVerified();setPrincipal(null);setWorkspace(null);setQueue([]);setNotice('Protected queues retained; sample workspacenstration selected.')})}<View style={{flexDirection:'row',gap:8}}>{(principal?.customerIds||['c1','c2','c3','c4']).filter(id=>['c1','c2','c3','c4'].includes(id)).map(id=><Pressable key={id} disabled={busy} onPress={()=>selectCustomer(id)}><Text style={{padding:8,fontWeight:id===customerId?'800':'400'}}>{id}</Text></Pressable>)}</View><Text>Input: {inputMode}</Text>{press(inputMode==='keyboard'?'Use DataWedge intent input':'Use keyboard-wedge input',()=>setInputMode(inputMode==='keyboard'?'intent':'keyboard'))}<TextInput accessibilityLabel="Workflow barcode" value={barcode} onChangeText={setBarcode} onSubmitEditing={()=>scan()} autoCapitalize="characters" autoCorrect={false} style={{padding:14,borderWidth:1,borderColor:'#a8c9d9'}}/>{press('Process workflow scan',()=>scan())}<View style={{flexDirection:'row',flexWrap:'wrap',gap:5}}>{['Retrieval','Withdrawal','Refile','Receiving'].map(op=><Pressable key={op} onPress={()=>setOperation(op)}><Text style={{padding:8,fontWeight:op===operation?'800':'400'}}>{op}</Text></Pressable>)}</View>{press('Register expected DEMO item',()=>perform({type:'register_record',barcode:barcode.trim().toUpperCase(),kind:barcode.toUpperCase().includes('-FL-')?'File':'Box'}))}{press('Create '+operation+' order',()=>perform({type:'create_order',orderId:'demo-'+Date.now(),operation,barcodes:[barcode.trim().toUpperCase()]}))}{workspace?.records.map(r=><Text key={r.barcode}>{r.barcode} · {r.status} · {r.location||r.custodian}</Text>)}{workspace?.orders.map(o=><View key={o.id}><Text>{o.id} · {o.status} · {o.items.map(x=>x.barcode+': '+x.status).join(', ')}</Text>{o.direction==='outbound'&&o.status==='staged'&&press('Dispatch with demo courier',()=>perform({type:'dispatch',orderId:o.id,orderVersion:o.version,courier:'demo-courier-1'}))}{o.status==='dispatched'&&press('Confirm demo delivery',()=>perform({type:'deliver',orderId:o.id,orderVersion:o.version,recipient:'demo-recipient-1'}))}</View>)}{press('Synchronize workflow queue',synchronize)}<Text accessibilityRole="alert">{notice}</Text>{queue.filter(x=>x.status!=='confirmed').map(event=><View key={event.clientEventId}><Text>{event.command.type} · {event.status} · attempts {event.attempts} {event.lastError||''}</Text>{event.status==='conflict'&&!event.supersededBy&&press('Review conflict with fresh server state',()=>refreshConflict(event))}</View>)}{conflict&&press('Create reviewed replacement action',rebuild)}<Text>Confirmed: {queue.filter(x=>x.status==='confirmed').length}. Custody events: {workspace?.custody.length||0}.</Text></View>;
}
