import {seedWarehouse,applyWarehouseCommand} from './workflows.js';
import {enqueue} from '../../src/sync-queue.js';
import {ApiError} from '../api-client/index.js';
export function createOfflineWarehouseStore({openDatabase,hashDigest}){
let connection;
async function db(){
 if(!connection)connection=openDatabase('irm-workflow-synthetic.db').then(async database=>{
  await database.execAsync(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS states (scope TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY,scope TEXT NOT NULL,payload TEXT NOT NULL);`);
  return database;
 }).catch(error=>{connection=null;throw error});
 return connection;
}
const scope=(actor,customer)=>actor+':'+customer;
async function stateFrom(database,key,customerId){const row=await database.getFirstAsync('SELECT payload FROM states WHERE scope=?',key);return row?JSON.parse(row.payload):seedWarehouse(customerId)}
async function loadWorkspace(actorId,customerId){return stateFrom(await db(),scope(actorId,customerId),customerId)}
async function cacheWorkspace(actorId,customerId,state){
 if(!state?.synthetic||state.customerId!==customerId)throw Error('Synthetic workspace required');
 const database=await db();await database.runAsync('INSERT OR REPLACE INTO states(scope,payload) VALUES(?,?)',scope(actorId,customerId),JSON.stringify(state));
}
async function stageCommand(actorId,customerId,command,replaces=null){
 const database=await db();let next;
 await database.withExclusiveTransactionAsync(async transaction=>{
  const state=await stateFrom(transaction,scope(actorId,customerId),customerId);
  next=(await applyWarehouseCommand(state,command,actorId,new Date().toISOString(),hashDigest)).state;
  const event=enqueue([],{clientEventId:command.clientEventId,customerId,actorId,command})[0];
  if(replaces){
   const row=await transaction.getFirstAsync('SELECT payload FROM queue WHERE id=? AND scope=?',replaces,scope(actorId,customerId));
   const original=row?JSON.parse(row.payload):null;
   if(!original||original.status!=='conflict'||original.supersededBy)throw Error('Conflict is no longer available for replacement');
   original.supersededBy=event.clientEventId;event.replaces=replaces;
   await transaction.runAsync('UPDATE queue SET payload=? WHERE id=?',JSON.stringify(original),replaces);
  }
  await transaction.runAsync('INSERT INTO queue(id,scope,payload) VALUES(?,?,?)',event.clientEventId,scope(actorId,customerId),JSON.stringify(event));
  await transaction.runAsync('INSERT OR REPLACE INTO states(scope,payload) VALUES(?,?)',scope(actorId,customerId),JSON.stringify(next));
 });return next;
}
function workflowRepository(actorId,customerId){
 const key=scope(actorId,customerId);
 return {
  async read(){const rows=await (await db()).getAllAsync('SELECT payload FROM queue WHERE scope=? ORDER BY rowid',key);return rows.map(x=>JSON.parse(x.payload))},
  async write(queue){const database=await db();await database.withExclusiveTransactionAsync(async transaction=>{for(const event of queue){if(event.actorId!==actorId||event.customerId!==customerId)throw Error('Queue owner mismatch');await transaction.runAsync('UPDATE queue SET payload=? WHERE id=? AND scope=?',JSON.stringify(event),event.clientEventId,key)}})}
 };
}
function syntheticWorkflowReceiver(){return {async submitScan(event){
 const database=await db();let result;
 await database.withExclusiveTransactionAsync(async transaction=>{
  const key='receiver:'+event.actorId+':'+event.customerId;
  const current=await stateFrom(transaction,key,event.customerId);
  try{result=await applyWarehouseCommand(current,event.command,event.actorId,new Date().toISOString(),hashDigest)}catch(error){throw new ApiError(error.message,error.status||409)}
  await transaction.runAsync('INSERT OR REPLACE INTO states(scope,payload) VALUES(?,?)',key,JSON.stringify(result.state));
 });return {status:result.status};
}}}

return {loadWorkspace,cacheWorkspace,stageCommand,workflowRepository,syntheticWorkflowReceiver};
}
