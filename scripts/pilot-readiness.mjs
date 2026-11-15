import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sep,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {evaluatePilot} from '../packages/readiness/pilot.js';
const root=resolve(import.meta.dirname,'..'),out=join(root,'dist','readiness');await mkdir(out,{recursive:true});
const run=(args)=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:8*1024*1024});
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
const checks={};
checks.workingTree={passed:spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim()==='',reference:'git status --porcelain'};
for(const [name,args] of [['tests',['--test','--test-reporter=tap','tests/*.test.js']],['webBuild',['scripts/build-web.mjs']],['workerPackage',['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir','dist/worker']]]){
 const result=run(args);await writeFile(join(out,name+'.log'),(result.stdout||'')+(result.stderr||''));checks[name]={passed:result.status===0,reference:'dist/readiness/'+name+'.log'};console.log(name+': '+(result.status===0?'PASS':'FAIL'));
}
const path=process.argv.find(x=>x.startsWith('--evidence='))?.slice('--evidence='.length);let external={};
if(path){const data=await readFile(resolve(root,path),'utf8');if(data.length>65536)throw Error('Evidence file too large');external=JSON.parse(data);if(external.commit!==git)throw Error('Evidence must refer to the current commit');}
for(const name of ['localD1','androidBundle','androidInstaller','zebraModule','windowsInstaller'])if(external.checks?.[name]){
 const supplied=external.checks[name];checks[name]={passed:false,reference:supplied.reference||null};
 if(supplied.passed){
  const proof=resolve(root,supplied.reference||'');if(!proof.startsWith(root+sep)||!supplied.sha256)throw Error('Platform evidence requires a workspace file and SHA-256');
  const bytes=await readFile(proof);if(createHash('sha256').update(bytes).digest('hex')!==supplied.sha256)throw Error('Platform evidence hash mismatch: '+name);
  checks[name]={passed:true,reference:supplied.reference,sha256:supplied.sha256};
 }
}
let advisories={high:null,critical:null};
const npm=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(existsSync(npm)){
 const audit=spawnSync(process.execPath,[npm,'audit','--json','--fetch-retries=0'],{cwd:join(root,'apps/mobile'),encoding:'utf8',maxBuffer:8*1024*1024,env:process.env});
 await writeFile(join(out,'mobile-audit.json'),audit.stdout||'{}');
 try{const parsed=JSON.parse(audit.stdout);if(parsed.metadata?.vulnerabilities)advisories=parsed.metadata.vulnerabilities}catch{}
}
const result=evaluatePilot({checks,advisories,evidence:external.evidence,commit:git});await writeFile(join(out,'readiness.json'),JSON.stringify(result,null,2)+'\n');
console.log('Demo ready: '+result.demoReady+'; production ready: '+result.productionReady);console.log('Evidence: dist/readiness/readiness.json');
if(!['tests','webBuild','workerPackage'].every(name=>checks[name].passed))process.exitCode=1;
