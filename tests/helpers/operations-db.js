import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {digest} from '../../api/auth.js';
import {handler} from '../../api/worker.js';
import {DATASET_VERSION} from '../../packages/operations/sample.js';
export async function operationsFixture(){
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../../migrations/'+f,import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../../scripts/seed-demo.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES('u1','sample-manager','Demo manager','manager',1);INSERT INTO user_customer_access VALUES('u1','c2');");
 let failAudit=false;
 const DB={prepare(sql){let args=[];const q={bind(...a){args=a;return q},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){if(failAudit&&sql.startsWith('INSERT INTO access_audit'))throw Error('Audit outage');return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}};return q},async batch(queries){db.exec('BEGIN');try{const r=[];for(const q of queries)r.push(await q.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 const token='irm_session_extended';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+600000);
 const env={DB,SYNTHETIC_OPERATIONS_ENABLED:'true',SYNTHETIC_COMMERCIAL_ENABLED:'true',SYNTHETIC_FIELD_ENABLED:'true',SYNTHETIC_WORKFLOWS_ENABLED:'true'},p={id:'u1',active:true,role:'manager',customerIds:['c2']};
 const request=(path,body)=>handler(new Request('http://localhost/v1/operations/'+path+(body?'':(path.includes('?')?'&':'?')+'customerId=c2'),{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify({customerId:'c2',...body}):undefined}),env);
 await request('sample',{datasetVersion:DATASET_VERSION});
 return {db,env,p,request,auditOutage(v){failAudit=v}};
}
