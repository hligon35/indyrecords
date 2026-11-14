import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,delimiter} from 'node:path';
const mode=process.argv[2];
if(!['dev','build'].includes(mode))throw Error('Use dev or build');
const cargo=join(homedir(),'.cargo','bin');
const env={...process.env,PATH:(existsSync(cargo)?cargo+delimiter:'')+process.env.PATH};
const cli='node_modules/@tauri-apps/cli/tauri.js';
const icons=spawnSync(process.execPath,[cli,'icon','../../assets/irm-icon.svg'],{stdio:'inherit',env});
if(icons.status!==0)process.exit(icons.status||1);
const args=[cli,mode];
// Embed only an explicitly approved read-only origin, never credentials.
if(env.IRM_READONLY_API_ORIGIN){
 const url=new URL(env.IRM_READONLY_API_ORIGIN);
 if(url.protocol!=='https:'||url.origin!==env.IRM_READONLY_API_ORIGIN)throw Error('IRM_READONLY_API_ORIGIN must be a clean HTTPS origin');
 args.push('--config',JSON.stringify({app:{security:{csp:`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:8787 http://127.0.0.1:8787 ${url.origin}; object-src 'none'; base-uri 'self'`}}}));
}
const result=spawnSync(process.execPath,args,{stdio:'inherit',env});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
