import React,{useEffect,useRef,useState} from 'react';
import {View,Text,TextInput,Pressable} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import {nativeSignIn} from '../../packages/security/native-login.js';
import {createApiClient} from '../../packages/api-client/index.js';
import {accountSession} from './account-session.js';
import {useAccount} from './AccountProvider.js';
export default function UserLoginPanel(){
 const session=useAccount(),[origin,setOrigin]=useState(''),[query,setQuery]=useState(''),[records,setRecords]=useState([]),[detail,setDetail]=useState(null),[notice,setNotice]=useState('Sign in once for scoped inventory and driver operations.'),[busy,setBusy]=useState(false),lock=useRef(false),generation=useRef(0);
 const api=()=>{const s=accountSession.current;if(!s)throw Error('Sign in required');return createApiClient({baseUrl:s.baseUrl,getAccessToken:()=>s.accessToken})};
 useEffect(()=>{generation.current++;setRecords([]);setDetail(null);if(session)setOrigin(session.baseUrl)},[session?.user?.id,session?.baseUrl,session?.accessToken]);
 async function run(work){if(lock.current)return;lock.current=true;setBusy(true);try{await work()}catch(e){setNotice(e.message);if([401,403].includes(e.status))await accountSession.clear()}finally{lock.current=false;setBusy(false)}}
 const signin=()=>run(async()=>{
  const candidate=await nativeSignIn({baseUrl:origin.trim(),redirectUri:'irmrmsdemo://auth',randomHex:()=>[...Crypto.getRandomBytes(32)].map(b=>b.toString(16).padStart(2,'0')).join(''),challengeFor:async value=>(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value,{encoding:Crypto.CryptoEncoding.BASE64})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),openSession:WebBrowser.openAuthSessionAsync});
  await accountSession.setSession(candidate);setNotice('Signed in. Inventory remains read-only; eligible drivers can connect their customer scope below.');
 });
 const logout=()=>run(async()=>{await accountSession.clear({remote:true});setNotice('Signed out across account and driver screens. Protected pending queues remain isolated.');});
 const search=()=>run(async()=>{const current=generation.current,result=await api().searchRecords({q:query,limit:100});if(current!==generation.current)return;setRecords(result.items);setDetail(null);setNotice(result.nextCursor?'Showing the first 100 results. Narrow the search.':result.items.length+' matching records.');});
 const button=(label,action)=><Pressable accessibilityRole="button" disabled={busy} onPress={action} style={{padding:12,borderRadius:8,backgroundColor:'#146d9c'}}><Text style={{color:'white',fontWeight:'700'}}>{label}</Text></Pressable>;
 return <View style={{backgroundColor:'white',padding:16,borderRadius:16,gap:12}}><Text style={{fontSize:20,fontWeight:'800'}}>Approved account</Text>{session?<><Text>{session.user.id} · {session.user.role} · {session.offline ? "Cached offline identity; original expiry applies" : "Verified account"}</Text>{button('Sign out everywhere',logout)}<TextInput value={query} onChangeText={setQuery} accessibilityLabel="Account inventory search" placeholder="Barcode, customer or location" onSubmitEditing={search}/>{button('Search read-only inventory',search)}{records.map(row=><Pressable key={row.id||row.barcode} disabled={busy} onPress={()=>run(async()=>{const current=generation.current,value=await api().getRecord(row.barcode);if(current===generation.current)setDetail(value)})}><Text>{row.barcode} · {row.kind} · {row.status}</Text></Pressable>)}{detail&&<Text>{detail.barcode} · {detail.customer} · {detail.location} · {detail.status}</Text>}</>:<><TextInput accessibilityLabel="Approved API origin" autoCapitalize="none" value={origin} onChangeText={setOrigin} placeholder="https://approved-api.example"/>{button('Sign in through system browser',signin)}</>}<Text accessibilityRole="alert">{notice}</Text><Text>No shared API token or pasted driver session is used. Driver mutations remain restricted by the Worker to approved local synthetic operation.</Text></View>;
}
