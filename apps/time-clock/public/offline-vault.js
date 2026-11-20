const encoder = new TextEncoder();
const decoder = new TextDecoder();

function openDatabase() {
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('irm-time-clock-offline',1);
  request.onupgradeneeded=()=>{
   request.result.createObjectStore('vaults',{keyPath:'id'});
   const drafts=request.result.createObjectStore('drafts',{keyPath:'id'});
   drafts.createIndex('employee','employee');
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('Offline storage is busy. Close other Time Clock windows and retry.'));
 });
}

async function useStore(name,mode,operation) {
 const db=await openDatabase();
 try {
  return await new Promise((resolve,reject)=>{
   const transaction=db.transaction(name,mode);
   const request=operation(transaction.objectStore(name));
   transaction.oncomplete=()=>resolve(request.result);
   transaction.onabort=()=>reject(transaction.error || Error('Offline storage could not be updated.'));
  });
 } finally { db.close(); }
}

async function deriveKey(passphrase,salt) {
 const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,
  {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

async function encrypt(key,context,value) {
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const protectedData=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},
  key,encoder.encode(JSON.stringify(value)));
 return {iv,protectedData};
}

async function decrypt(key,context,{iv,protectedData}) {
 const value=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},key,protectedData);
 return JSON.parse(decoder.decode(value));
}

export async function unlockVault(employee,passphrase,activeSite) {
 const prior=await useStore('vaults','readonly',store=>store.get(employee));
 if(!prior && (!activeSite || passphrase.length<12)) {
  throw Error(activeSite?'Use an offline passphrase of at least 12 characters.':'No offline vault is available for this employee ID.');
 }
 const salt=prior?.salt || crypto.getRandomValues(new Uint8Array(16));
 const key=await deriveKey(passphrase,salt);
 const context='vault:'+employee;
 let site=activeSite;
 if(prior) {
  let saved;
  try { saved=await decrypt(key,context,prior); }
  catch { throw Error('Could not unlock offline requests with those credentials.'); }
  site=activeSite || saved.site;
 }
 if(!prior || activeSite) {
  const encrypted=await encrypt(key,context,{site});
  await useStore('vaults','readwrite', store=>prior?
   store.put({id:employee,salt,...encrypted}):store.add({id:employee,salt,...encrypted}));
 }
 return {employee,site,key};
}

export async function queueDraft(vault,draft) {
 const id=draft.requestId;
 const encrypted=await encrypt(vault.key,'draft:'+vault.employee+':'+id,draft);
 await useStore('drafts','readwrite',store=>store.add({id,employee:vault.employee,...encrypted}));
}

export async function queuedDrafts(vault) {
 const records=await useStore('drafts','readonly',store=>store.index('employee').getAll(vault.employee));
 return Promise.all(records.map(record=>decrypt(vault.key,'draft:'+vault.employee+':'+record.id,record)));
}

export function deleteDraft(vault,id) {
 return useStore('drafts','readwrite',store=>store.index('employee').getAllKeys(vault.employee))
  .then(keys=>keys.includes(id)?useStore('drafts','readwrite',store=>store.delete(id)):undefined);
}
