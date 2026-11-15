import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {initCompactShell,navigationMarkup,enhanceCompactView} from '../src/compact-ui.js';
import {workspaceVisibility,isWideWorkspace} from '../packages/ui/compact.js';
test('compact shell preserves density preference and exposes keyboard-operable grouped navigation',()=>{
 const doc=new JSDOM('<aside class="sidebar"><button id="nav-toggle"></button><nav id="nav"></nav></aside><select id="density"><option>compact</option><option>comfortable</option></select>').window.document,map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 doc.querySelector('nav').innerHTML=navigationMarkup([['overview','Overview'],['scanner','Scanner'],['commercial','Office']],'scanner');
 const shell=initCompactShell({document:doc,storage});assert.equal(doc.documentElement.dataset.density,'compact');assert.equal(doc.querySelectorAll('[aria-current="page"]').length,1);
 doc.querySelector('#nav-toggle').click();assert.equal(doc.querySelector('#nav-toggle').getAttribute('aria-expanded'),'true');assert.equal(doc.activeElement.dataset.page,'scanner');
 doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(doc.querySelector('#nav-toggle').getAttribute('aria-expanded'),'false');assert.equal(doc.activeElement.id,'nav-toggle');
 const select=doc.querySelector('#density');select.value='comfortable';select.dispatchEvent(new doc.defaultView.Event('change'));assert.equal(map.get('irm-ui-density'),'comfortable');shell.closeMenu();
});
test('compact disclosure keeps full values and existing action handlers while making tables keyboard reachable',()=>{
 const doc=new JSDOM('<main><h2>Inventory</h2><pre>{"status":"pending","text":"&lt;script&gt;"}</pre><div class="table-wrap"><table><tbody><tr><td></td><td><button>Pick</button></td></tr></tbody></table></div></main>').window.document,root=doc.querySelector('main'),long='Full multilingual value Café '.repeat(20);root.querySelector('td').textContent=long;let picked=false;root.querySelector('button').onclick=()=>{picked=true};
 enhanceCompactView(root);assert.equal(root.querySelector('.table-wrap').tabIndex,0);assert.equal(root.querySelector('.cell-details pre').textContent,long);assert.ok(!root.querySelector('.cell-details').open);root.querySelector('button').click();assert.equal(picked,true);assert.equal(root.querySelector('script'),null);
});
test('native compact navigation keeps visited state but exposes just one workspace and adapts tablets',()=>{
 const panes=workspaceVisibility('driver',['scan','warehouse','driver']);assert.equal(panes.length,3);assert.deepEqual(panes.filter(p=>p.active).map(p=>p.id),['driver']);assert.equal(isWideWorkspace(390),false);assert.equal(isWideWorkspace(1000),true);
});
