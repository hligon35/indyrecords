import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=join(root,'dist','readiness','restore-'+Date.now());await mkdir(out,{recursive:true});
if(!process.argv.includes('--synthetic-local'))throw Error('Explicit --synthetic-local is required; remote restore is unsupported');
const backup=join(out,'synthetic-backup.sql');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','export','irm-rms-demo','--local','--output',backup],{cwd:root,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(result.status!==0)throw Error('Local D1 export failed: '+result.stderr);
if((await stat(backup)).size>10*1024*1024)throw Error('Unexpected backup size');
const sql=await readFile(backup,'utf8'),db=new DatabaseSync(join(out,'restored.db'));
try{
 db.exec(sql);
 const source=db.prepare('SELECT barcode,customer_id FROM records').all();
 if(source.some(x=>!/^IRM-(BX|FL)-10\d\d$/.test(x.barcode)||!['c1','c2','c3','c4'].includes(x.customer_id)))throw Error('Restore drill is restricted to the fictional source fixtures');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Restored database failed integrity check');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Restored database failed foreign key check');
 // A backup must not revive sessions or one-time codes revoked after the snapshot.
 db.prepare('UPDATE app_sessions SET revoked_at=?').run(Date.now());db.exec('DELETE FROM login_attempts; DELETE FROM auth_rate_limits;');
 const counts={};for(const table of ['customers','records','sandbox_workspaces','customer_profiles','integration_jobs','access_audit'])counts[table]=db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 const report={schemaVersion:1,synthetic:true,passed:true,generatedAt:new Date().toISOString(),backupSha256:createHash('sha256').update(sql).digest('hex'),counts,integrity:'ok',foreignKeys:'ok',sessionsRevoked:true,oneTimeCodesRemoved:true,sourceDatabaseModified:false};
 await writeFile(join(out,'restore-evidence.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: local D1 backup restored into a separate database; sessions/codes invalidated.');console.log(join(out,'restore-evidence.json'));
}finally{db.close()}
