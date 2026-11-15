import {migrateProtectedLegacy} from '../../../packages/security/offline-migration.js';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import {createOfflineFieldStore} from '../../../packages/field/offline-store.js';
import {protectedDatabaseFactory} from '../../../packages/security/protected-database.js';
const hash=value=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value);
export function createMobileProtectedStore({name,createStore,legacyName,demoActor,roles,validateState}){
const demo=createStore({openDatabase:SQLite.openDatabaseAsync,hashDigest:hash}),stores=new Map();let epoch=0;
const openProtected=protectedDatabaseFactory({openDatabase:SQLite.openDatabaseAsync,hash,randomHex:()=>[...Crypto.getRandomBytes(32)].map(b=>b.toString(16).padStart(2,'0')).join(''),secureStore:{getItem:SecureStore.getItemAsync,setItem:(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}});
async function migrateLegacy(database,actor,tenant){const legacy=await SQLite.openDatabaseAsync(legacyName);try{await migrateProtectedLegacy({database,legacy,actor,tenant,hash,validateState})}finally{await legacy.closeAsync()}}
function requireStore(actor,tenant){
 if(actor===demoActor)return demo;
 const entry=stores.get(actor+':'+tenant);if(!entry||entry.expiresAt<=Date.now()||entry.epoch!==epoch)throw Error('Sign in and unlock this driver scope first');return entry.store;
}
const store={
 async unlockScope(session,tenant){
  if(!session||!roles.includes(session.user?.role)||!session.customerIds?.includes(tenant)||session.expiresAt<=Date.now())throw Error('Active scoped warehouse account required');
  if(!['localhost','127.0.0.1'].includes(new URL(session.baseUrl).hostname))throw Error('Verified offline workflows require the approved loopback API');
  const actor=session.user.id,key=actor+':'+tenant;if(stores.get(key)?.epoch===epoch)return;
  const ticket=epoch,entry={epoch:ticket,expiresAt:session.expiresAt,connection:null,store:null};
  const check=()=>{if(ticket!==epoch||entry.expiresAt<=Date.now())throw Error('Driver scope locked')};
  entry.store=createStore({hashDigest:hash,migrateFrom:session.offline?null:db=>migrateLegacy(db,actor,tenant),openDatabase:async()=>{
   check();entry.connection=openProtected(JSON.stringify([name,session.baseUrl,actor]),tenant,{requireExisting:session.offline===true});const db=await entry.connection;check();
   return {execAsync:async(...args)=>{check();return db.execAsync(...args)},getFirstAsync:async(...args)=>{check();return db.getFirstAsync(...args)},getAllAsync:async(...args)=>{check();return db.getAllAsync(...args)},runAsync:async(...args)=>{check();return db.runAsync(...args)},withExclusiveTransactionAsync:work=>db.withExclusiveTransactionAsync(async tx=>{check();const result=await work(tx);check();return result})};
  }});
  stores.set(key,entry);
  try{await entry.store.loadWorkspace(actor,tenant);check();if(session.offline&&!(await (await entry.connection).getFirstAsync('SELECT scope FROM states WHERE scope=?',key)))throw Error('No previously approved cached workspace exists. Connect online first.')}catch(e){stores.delete(key);await entry.connection?.then(db=>db.closeAsync()).catch(()=>{});throw e}
 },
 lockVerified(){epoch++;for(const entry of stores.values())entry.connection?.then(db=>db.closeAsync()).catch(()=>{});stores.clear()},
 loadWorkspace:(actor,tenant)=>requireStore(actor,tenant).loadWorkspace(actor,tenant),
 cacheWorkspace:(actor,tenant,state)=>requireStore(actor,tenant).cacheWorkspace(actor,tenant,state),
 stageCommand:(actor,tenant,command,replaces)=>requireStore(actor,tenant).stageCommand(actor,tenant,command,replaces),
 workflowRepository:(actor,tenant)=>requireStore(actor,tenant).workflowRepository(actor,tenant),
 dismissConflict:(actor,tenant,id,reason)=>requireStore(actor,tenant).dismissConflict(actor,tenant,id,reason),
 syntheticWorkflowReceiver:()=>demo.syntheticWorkflowReceiver()
};

return store;
}
export const fieldStore=createMobileProtectedStore({name:'driver',createStore:createOfflineFieldStore,legacyName:'irm-field-synthetic.db',demoActor:'local-demo-driver',roles:['warehouse'],validateState:(state,actor)=>state.jobs.every(j=>j.driverId===actor)});
