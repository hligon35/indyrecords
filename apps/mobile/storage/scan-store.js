// Device-local durable queue. No sensitive company data should be stored in this prototype.
// expo-sqlite persists rows, but database encryption and secure device provisioning
// are not configured. Do not use for real customer data.
import * as SQLite from 'expo-sqlite';

let connection;
async function db(){
 if(!connection){
  connection=SQLite.openDatabaseAsync('irm-rms-demo.db').then(async database=>{
   await database.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS demo_scan_events (
      client_event_id TEXT PRIMARY KEY,
      barcode TEXT NOT NULL,
      operation TEXT NOT NULL,
      mode TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','sending','confirmed','conflict')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0
    );`);
   return database;
  }).catch(error=>{connection=null;throw error});
 }
 return connection;
}
export async function listScans(){
 const database=await db();
 const rows=await database.getAllAsync('SELECT * FROM demo_scan_events ORDER BY occurred_at DESC, client_event_id DESC');
 return rows.map(row=>({
  clientEventId:row.client_event_id,barcode:row.barcode,operation:row.operation,
  mode:row.mode,occurredAt:row.occurred_at,status:row.status,
  attempts:row.attempts,nextAttemptAt:row.next_attempt_at
 }));
}
export async function addScan({clientEventId,barcode,operation,mode,occurredAt}){
 if(!clientEventId||!barcode||!operation||!['inbound','outbound'].includes(mode)||!occurredAt)throw Error('Invalid scan');
 const database=await db();
 const result=await database.runAsync(
  'INSERT OR IGNORE INTO demo_scan_events(client_event_id,barcode,operation,mode,occurred_at,status) VALUES(?,?,?,?,?,?)',
  clientEventId,barcode,operation,mode,occurredAt,'pending'
 );
 return result.changes===1;
}
export async function writeQueue(queue){
 const database=await db();
 await database.withTransactionAsync(async()=>{
  for(const event of queue){
   await database.runAsync(
    `UPDATE demo_scan_events SET status=?,attempts=?,next_attempt_at=? WHERE client_event_id=?`,
    event.status,event.attempts||0,event.nextAttemptAt||0,event.clientEventId
   );
  }
 });
}
export const scanRepository={read:listScans,write:writeQueue};
