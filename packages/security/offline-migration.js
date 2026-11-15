// Copy before removing active legacy rows. A marker makes interrupted cleanup replay-safe.
export async function migrateProtectedLegacy({database,legacy,actor,tenant,hash,validateState}){
 const key=actor+':'+tenant;
 if(!(await legacy.getFirstAsync("SELECT name FROM sqlite_master WHERE name='states'")))return;
 const source=await legacy.getFirstAsync('SELECT payload FROM states WHERE scope=?',key),queue=await legacy.getAllAsync('SELECT id,payload FROM queue WHERE scope=? ORDER BY rowid',key);
 if(!source&&!queue.length)return;
 const state=source?JSON.parse(source.payload):null;
 if(state&&(!state.synthetic||state.customerId!==tenant||!validateState(state,actor,tenant)))throw Error('Legacy assignments require ownership review; original data was preserved.');
 for(const row of queue){const e=JSON.parse(row.payload);if(e.actorId!==actor||e.customerId!==tenant||e.clientEventId!==row.id)throw Error('Legacy queue ownership mismatch; original data was preserved.')}
 const fingerprint=await hash(JSON.stringify({source,queue}));
 await database.execAsync('CREATE TABLE IF NOT EXISTS legacy_migrations(scope TEXT PRIMARY KEY,source_hash TEXT NOT NULL)');
 await database.withExclusiveTransactionAsync(async tx=>{
  const prior=await tx.getFirstAsync('SELECT source_hash FROM legacy_migrations WHERE scope=?',key);
  if(prior){if(prior.source_hash!==fingerprint)throw Error('Legacy source changed after migration; review required.');return}
  if(await tx.getFirstAsync('SELECT scope FROM states WHERE scope=?',key))throw Error('Existing protected and legacy data overlap; review required.');
  if(source)await tx.runAsync('INSERT INTO states(scope,payload) VALUES(?,?)',key,source.payload);
  for(const row of queue)await tx.runAsync('INSERT INTO queue(id,scope,payload) VALUES(?,?,?)',row.id,key,row.payload);
  await tx.runAsync('INSERT INTO legacy_migrations(scope,source_hash) VALUES(?,?)',key,fingerprint);
 });
 await legacy.execAsync('PRAGMA secure_delete=ON');
 await legacy.withExclusiveTransactionAsync(async tx=>{
  const current={source:await tx.getFirstAsync('SELECT payload FROM states WHERE scope=?',key),queue:await tx.getAllAsync('SELECT id,payload FROM queue WHERE scope=? ORDER BY rowid',key)};
  if(await hash(JSON.stringify(current))!==fingerprint)throw Error('Legacy queue changed; protected copy retained and source preserved.');
  await tx.runAsync('DELETE FROM queue WHERE scope=?',key);await tx.runAsync('DELETE FROM states WHERE scope=?',key);
 });
 await legacy.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
}
