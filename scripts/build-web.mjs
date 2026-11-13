import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'dist','web');
for(const dir of ['','src','assets'])await mkdir(join(out,dir),{recursive:true});
for(const file of ['index.html','styles.css','sw.js','manifest.webmanifest','src/app.js','src/domain.js','assets/irm-icon.svg'])await copyFile(join(root,file),join(out,file));
console.log('Static demo built to dist/web');
