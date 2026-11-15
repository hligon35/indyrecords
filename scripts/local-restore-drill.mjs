import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile,stat,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=join(root,'dist','readiness','restore-'+Date.now());await mkdir(out,{recursive:true});
if(!process.argv.includes('--synthetic-local'))throw Error('Explicit --synthetic-local is required; remote restore is unsupported');
const persist=process.argv.find(arg=>arg.startsWith('--persist-to='))?.slice('--persist-to='.length);
if(persist&&!resolve(root,persist).startsWith(join(root,'.wrangler')+sep))throw Error('Restore fixtures must stay in a workspace .wrangler subdirectory');
const backup=join(out,persist?'synthetic-backup.sqlite':'synthetic-backup.sql');
if(persist){
 // Wrangler export has no --persist-to option; use SQLite's consistent online backup API.
 const dir=join(root,persist,'v3','d1'),files=(await readdir(dir,{recursive:true})).filter(f=>f.endsWith('.sqlite'));
 const candidates=[];
 for(const file of files){const source=new DatabaseSync(join(dir,file),{readOnly:true});try{if(source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'").get())candidates.push(join(dir,file))}finally{source.close()}}
 if(candidates.length!==1)throw Error('Select an isolated fixture directory containing exactly one records database');
 const source=new DatabaseSync(candidates[0],{readOnly:true});try{await sqliteBackup(source,backup)}finally{source.close()}
}else{
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','export','irm-rms-demo','--local','--output',backup],{cwd:root,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.status!==0)throw Error('Local D1 export failed: '+result.stderr);
}
if((await stat(backup)).size>10*1024*1024)throw Error('Unexpected backup size');
const bytes=await readFile(backup);
if(persist){const source=new DatabaseSync(backup,{readOnly:true});try{await sqliteBackup(source,join(out,'restored.db'))}finally{source.close()}}
const db=new DatabaseSync(join(out,'restored.db'));
try{
 if(!persist)db.exec(bytes.toString('utf8'));
 const source=db.prepare('SELECT barcode,customer_id FROM records').all();
 if(source.some(x=>!/^IRM-(BX|FL)-10\d\d$/.test(x.barcode)||!['c1','c2','c3','c4'].includes(x.customer_id)))throw Error('Restore drill is restricted to the fictional source fixtures');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Restored database failed integrity check');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Restored database failed foreign key check');
 // A backup must not revive sessions or one-time codes revoked after the snapshot.
 db.prepare('UPDATE app_sessions SET revoked_at=?').run(Date.now());db.exec('DELETE FROM login_attempts; DELETE FROM auth_rate_limits;');
 const counts={};for(const table of ['customers','records','sandbox_workspaces','customer_profiles','integration_jobs','acceptance_observations','commercial_workspaces','field_workspaces','sample_datasets','backend_tasks','backend_task_history','report_exports','report_export_rows','document_archive','finance_reconciliations','operation_alerts','operational_entities','access_audit'])counts[table]=db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 const report={schemaVersion:1,synthetic:true,passed:true,generatedAt:new Date().toISOString(),backupFormat:persist?'sqlite':'sql',backupSha256:createHash('sha256').update(bytes).digest('hex'),counts,integrity:'ok',foreignKeys:'ok',sessionsRevoked:true,oneTimeCodesRemoved:true,sourceDatabaseModified:false};
 await writeFile(join(out,'restore-evidence.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: local D1 backup restored into a separate database; sessions/codes invalidated.');console.log(join(out,'restore-evidence.json'));
}finally{db.close()}
