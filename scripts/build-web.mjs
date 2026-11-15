import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'dist','web');
for(const dir of ['','src','assets','assets/icons','packages/api-client','packages/warehouse'])await mkdir(join(out,dir),{recursive:true});
for(const file of ['index.html','styles.css','compact.css','sw.js','manifest.webmanifest','src/domain.js','src/remote-readonly.js','src/login.js','src/warehouse-view.js','packages/warehouse/workflows.js','packages/api-client/index.js','assets/icons/32x32.png','assets/icons/180x180.png','assets/icons/192x192.png','assets/icons/512x512.png'])await copyFile(join(root,file),join(out,file));


await build({entryPoints:[join(root,'src/app.js')],outfile:join(out,'src/app.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});

console.log('Static demo built to dist/web');
