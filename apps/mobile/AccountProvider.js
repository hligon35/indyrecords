import React,{createContext,useContext,useEffect,useState} from 'react';
import {AppState} from 'react-native';
import {accountSession} from './account-session.js';
const Context=createContext(null);
export function AccountProvider({children}){
 const [session,setSession]=useState(null);
 useEffect(()=>{const off=accountSession.subscribe(setSession);accountSession.restore().catch(()=>{});const sub=AppState.addEventListener('change',state=>{if(state==='active'&&accountSession.current)accountSession.verifyCurrent().catch(()=>{})});return()=>{off();sub.remove()}},[]);
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>accountSession.clear().catch(()=>{}),Math.max(0,session.expiresAt-Date.now()));return()=>clearTimeout(timer)},[session]);
 return <Context.Provider value={session}>{children}</Context.Provider>;
}
export const useAccount=()=>useContext(Context);
