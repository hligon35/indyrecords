import React,{useEffect,useRef,useState} from 'react';
import {View,Text,Pressable,TextInput,AppState} from 'react-native';
import {createApiClient,ApiError} from '../../packages/api-client/index.js';
import {createSyncCoordinator} from '../../packages/api-client/sync.js';
import {workflowRepository,loadWorkspace,stageCommand,cacheWorkspace,syntheticWorkflowReceiver} from './storage/warehouse-store.js';
import {subscribeScanner} from './scanner.js';
const button={backgroundColor:'#146d9c',padding:12,borderRadius:8,marginVertical:5};
export default function WarehousePanel(){
 const [workspace,setWorkspace]=useState(null),[queue,setQueue]=useState([]),[barcode,setBarcode]=useState('IRM-BX-1002'),[operation,setOperation]=useState('Retrieval'),[notice,setNotice]=useState('On-device synthetic workspace.'),[session,setSession]=useState(''),[principal,setPrincipal]=useState(null),[conflict,setConflict]=useState(null),[busy,setBusy]=useState(false),[inputMode,setInputMode]=useState('keyboard'),[customerId,setCustomerId]=useState('c2');
 const lock=useRef(false),current=useRef(null),sync=useRef(null),scanHandler=useRef(null);
 const actorId=principal?.user.id||'local-demo-manager';
 const repository=workflowRepository(actorId,customerId);
 const api=()=>createApiClient({baseUrl:'http://127.0.0.1:8787',getAccessToken:()=>session,readOnly:false});
 current.current={actorId,customerId,session,principal};
 async function reload(){setWorkspace(await loadWorkspace(actorId,customerId));setQueue(await repository.read())}
 useEffect(()=>{let active=true;setWorkspace(null);setQueue([]);Promise.all([loadWorkspace(actorId,customerId),repository.read()]).then(([state,events])=>{if(active){setWorkspace(state);setQueue(events)}}).catch(error=>{if(active)setNotice(error.message)});return ()=>{active=false}},[actorId,customerId]);
 useEffect(()=>{
  if(inputMode!=='intent')return;
  const subscription=subscribeScanner(value=>{setBarcode(value);scanHandler.current?.(value)});
  if(!subscription.available)setNotice('Native intent input requires a development APK. Keyboard input remains available.');
  return ()=>subscription.remove();
 },[inputMode]);
 async function perform(command,replaces=null){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const next=await stageCommand(actorId,customerId,{...command,clientEventId:globalThis.crypto?.randomUUID?.()||'demo-'+Date.now()+'-'+Math.random().toString(36).slice(2)},replaces);setWorkspace(next);setQueue(await repository.read());setNotice('Saved offline. Awaiting '+(principal?'local D1':'on-device simulator')+' acknowledgement.')}catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}
 }
 function scan(value=barcode){
  const code=value.trim().toUpperCase(),record=workspace?.records.find(x=>x.barcode===code);
  if(!record){setNotice('Barcode not in this customer’s synthetic inventory.');return}
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
   const receiver=principal?{async submitScan(event){if(event.actorId!==owner||!principal.customerIds.includes(event.customerId))throw new ApiError('Queue belongs to a different user/customer',403);const result=await api().submitWarehouseCommand(event.customerId,event.command);await cacheWorkspace(owner,event.customerId,{...result.workspace,receipts:[]});return result}}:syntheticWorkflowReceiver();
   sync.current=createSyncCoordinator({repository,api:receiver});const result=await sync.current.synchronize();await reload();if(result.status==='auth-required')setSession('');setNotice(result.status==='auth-required'?'Session expired. Sign in before retrying.':'Queue processed against '+(principal?'local D1.':'on-device simulator.'));
  }catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}
 }
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state==='active'&&sync.current&&!lock.current)synchronize()});return ()=>listener.remove()},[actorId,customerId,session]);
 async function connect(){if(lock.current)return;lock.current=true;setBusy(true);try{const user=await api().getSession();const granted=user.customerIds.filter(x=>['c1','c2','c3','c4'].includes(x));if(!granted.length)throw Error('No synthetic customers are granted');const target=granted.includes(customerId)?customerId:granted[0];const state=await api().getWorkspace(target);await cacheWorkspace(user.user.id,target,{...state,receipts:[]});setCustomerId(target);setPrincipal(user);setNotice('Verified local synthetic workspace connected.')}catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}}
 async function refreshConflict(event){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{if(!principal)throw Error('For local simulator conflicts, inspect the action and keep the original event for review.');const state=await api().getWorkspace(customerId);await cacheWorkspace(actorId,customerId,{...state,receipts:[]});setWorkspace(state);setConflict(event);setNotice('Fresh server state loaded. Review the rejected action before creating a replacement.')}catch(error){setNotice(error.message)}finally{lock.current=false;setBusy(false)}
 }
 async function rebuild(){if(!conflict||!workspace)return;const c={...conflict.command};delete c.clientEventId;const r=workspace.records.find(x=>x.barcode===c.barcode),o=workspace.orders.find(x=>x.id===c.orderId);if(r)c.expectedVersion=r.version;if(o)c.orderVersion=o.version;setConflict(null);await perform(c,conflict.clientEventId)}
 const press=(label,onPress)=><Pressable disabled={busy} accessibilityRole="button" onPress={onPress} style={button}><Text style={{color:'white',fontWeight:'700'}}>{label}</Text></Pressable>;
 return <View style={{padding:16,gap:10,backgroundColor:'white',borderRadius:16}}><Text style={{fontSize:20,fontWeight:'800'}}>Warehouse workflows · {customerId}</Text><Text>Synthetic records only · {principal?'Verified local D1':'On-device simulator'}</Text><TextInput accessibilityLabel="Temporary user session" secureTextEntry value={session} onChangeText={setSession} placeholder="Temporary user session for local D1"/>{press('Connect verified local sandbox',connect)}{principal&&press('Disconnect account',async()=>{if(lock.current)return;setPrincipal(null);setSession('');try{await api().endSession()}catch{}setNotice('Disconnected; other users’ queues remain isolated.')})}<View style={{flexDirection:'row',gap:8}}>{(principal?.customerIds||['c1','c2','c3','c4']).filter(id=>['c1','c2','c3','c4'].includes(id)).map(id=><Pressable key={id} disabled={busy} onPress={()=>{if(!lock.current)setCustomerId(id)}}><Text style={{padding:8,fontWeight:id===customerId?'800':'400'}}>{id}</Text></Pressable>)}</View><Text>Input: {inputMode}</Text>{press(inputMode==='keyboard'?'Use DataWedge intent input':'Use keyboard-wedge input',()=>setInputMode(inputMode==='keyboard'?'intent':'keyboard'))}<TextInput accessibilityLabel="Workflow barcode" value={barcode} onChangeText={setBarcode} onSubmitEditing={()=>scan()} autoCapitalize="characters" autoCorrect={false} style={{padding:14,borderWidth:1,borderColor:'#a8c9d9'}}/>{press('Process workflow scan',()=>scan())}<View style={{flexDirection:'row',gap:5}}>{['Retrieval','Withdrawal','Refile','Receiving'].map(op=><Pressable key={op} onPress={()=>setOperation(op)}><Text style={{padding:8,fontWeight:op===operation?'800':'400'}}>{op}</Text></Pressable>)}</View>{press('Register expected DEMO item',()=>perform({type:'register_record',barcode:barcode.trim().toUpperCase(),kind:barcode.toUpperCase().includes('-FL-')?'File':'Box'}))}{press('Create '+operation+' order',()=>perform({type:'create_order',orderId:'demo-'+Date.now(),operation,barcodes:[barcode.trim().toUpperCase()]}))}{workspace?.records.map(r=><Text key={r.barcode}>{r.barcode} · {r.status} · {r.location||r.custodian}</Text>)}{workspace?.orders.map(o=><View key={o.id}><Text>{o.id} · {o.status} · {o.items.map(x=>x.barcode+': '+x.status).join(', ')}</Text>{o.direction==='outbound'&&o.status==='staged'&&press('Dispatch with demo courier',()=>perform({type:'dispatch',orderId:o.id,orderVersion:o.version,courier:'demo-courier-1'}))}{o.status==='dispatched'&&press('Confirm demo delivery',()=>perform({type:'deliver',orderId:o.id,orderVersion:o.version,recipient:'demo-recipient-1'}))}</View>)}{press('Synchronize workflow queue',synchronize)}<Text accessibilityRole="alert">{notice}</Text>{queue.filter(x=>x.status!=='confirmed').map(event=><View key={event.clientEventId}><Text>{event.command.type} · {event.status} · attempts {event.attempts} {event.lastError||''}</Text>{event.status==='conflict'&&!event.supersededBy&&press('Review conflict with fresh server state',()=>refreshConflict(event))}</View>)}{conflict&&press('Create reviewed replacement action',rebuild)}<Text>Confirmed: {queue.filter(x=>x.status==='confirmed').length}. Custody events: {workspace?.custody.length||0}.</Text></View>;
}
