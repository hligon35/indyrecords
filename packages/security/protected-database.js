// Platform-independent SQLCipher key lifecycle; platform adapter supplies protected key storage.
export function protectedDatabaseFactory({openDatabase,secureStore,randomHex,hash}){
 return async function openProtected(actorId,customerId,{requireExisting=false}={}){
  if(typeof actorId!=='string'||!actorId||!['c1','c2','c3','c4'].includes(customerId))throw Error('Verified actor and synthetic customer required');
  const identity=await hash(JSON.stringify([actorId,customerId])),keyName='irm-field-key-'+identity,file='irm-field-protected-'+identity+'.db';
  const db=await openDatabase(file);
  try{
   if(!(await db.getFirstAsync('PRAGMA cipher_version'))?.cipher_version)throw Error('Protected offline storage requires a rebuilt SQLCipher-enabled app. No plaintext fallback is permitted.');
   let key=await secureStore.getItem(keyName);
   if(!key){
    if(requireExisting)throw Error('No protected offline key is available. Connect online first; existing data was preserved.');
    // Encrypted existing files cannot be read without their key: never replace a lost key.
    let count;try{count=await db.getFirstAsync("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'")}catch{throw Error('Offline encryption key is missing. Existing data was preserved; recovery is required.')}
    if(count?.n)throw Error('Unprotected or existing offline file needs reviewed migration; no key was replaced.');
    key=randomHex();if(!/^[a-f0-9]{64}$/.test(key))throw Error('A secure 256-bit encryption key is required');
    await secureStore.setItem(keyName,key);
   }
   if(!/^[a-f0-9]{64}$/.test(key))throw Error('Protected key is invalid; offline data was preserved.');
   await db.execAsync(`PRAGMA key = "x'${key}'";`);
   await db.getFirstAsync('SELECT COUNT(*) AS n FROM sqlite_master');
   return db;
  }catch(e){await db.closeAsync?.().catch(()=>{});throw e}
 };
}
