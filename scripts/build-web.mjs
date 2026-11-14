import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'dist','web');
for(const dir of ['','src','assets','packages/api-client','packages/warehouse'])await mkdir(join(out,dir),{recursive:true});
for(const file of ['index.html','styles.css','sw.js','manifest.webmanifest','src/domain.js','src/remote-readonly.js','src/login.js','src/warehouse-view.js','packages/warehouse/workflows.js','packages/api-client/index.js','assets/irm-icon.svg'])await copyFile(join(root,file),join(out,file));


await build({entryPoints:[join(root,'src/app.js')],outfile:join(out,'src/app.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});

console.log('Static demo built to dist/web');
