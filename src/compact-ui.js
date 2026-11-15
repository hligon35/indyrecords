const GROUPS=[['Daily work',['overview','scanner','inventory','warehouse','field']],['Office',['commercial','management','reports','activity']],['Administration',['remote','administration','operations','readiness','acceptance']]];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function navigationMarkup(nav,current){return GROUPS.map(([label,ids])=>'<div class="nav-group"><span class="nav-heading">'+label+'</span>'+ids.map(id=>{const item=nav.find(n=>n[0]===id);return item?'<button class="nav-btn '+(id===current?'active':'')+'" data-page="'+id+'" '+(id===current?'aria-current="page"':'')+'>'+escape(item[1])+'</button>':''}).join('')+'</div>').join('')}
export function initCompactShell({document,storage}){
 const select=document.getElementById('density'),toggle=document.getElementById('nav-toggle'),sidebar=document.querySelector('.sidebar');
 let density='compact';try{if(storage.getItem('irm-ui-density')==='comfortable')density='comfortable'}catch{}
 const apply=value=>{document.documentElement.dataset.density=value;select.value=value};apply(density);
 select.onchange=()=>{const value=select.value==='comfortable'?'comfortable':'compact';apply(value);try{storage.setItem('irm-ui-density',value)}catch{}};
 function closeMenu(){sidebar.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false')}
 toggle.onclick=()=>{const open=sidebar.classList.toggle('menu-open');toggle.setAttribute('aria-expanded',String(open));if(open)document.querySelector('#nav [aria-current="page"]')?.focus()};
 document.querySelector('[data-shell-reset]')?.addEventListener('click',()=>document.getElementById('reset')?.click());
 document.querySelector('[data-shell-signout]')?.addEventListener('click',()=>{closeMenu();document.getElementById('signout')?.click()});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.classList.contains('menu-open')){closeMenu();toggle.focus()}});
 return {closeMenu};
}
export function enhanceCompactView(root,{page='workspace',expanded=new Map()}={}){
 root.querySelectorAll('input[type="checkbox"],input[type="radio"]').forEach(input=>{if(input.closest('label'))return;const label=root.ownerDocument.createElement('label');label.className='compact-checkbox';input.replaceWith(label);label.append(input)});
 root.querySelectorAll('.table-wrap').forEach((wrap,i)=>{wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',(root.querySelector('h2')?.textContent||'Workspace')+' table '+(i+1))});
 root.querySelectorAll('td').forEach(cell=>{
  if(cell.children.length||cell.textContent.length<110)return;
  const text=cell.textContent,details=root.ownerDocument.createElement('details'),summary=root.ownerDocument.createElement('summary'),pre=root.ownerDocument.createElement('pre');details.className='data-details cell-details';summary.textContent='View full value';pre.textContent=text;details.append(summary,pre);cell.replaceChildren(details);
 });
 root.querySelectorAll('pre').forEach((pre,i)=>{
  if(pre.closest('details'))return;
  const key=page+':'+i,details=root.ownerDocument.createElement('details'),summary=root.ownerDocument.createElement('summary');details.className='data-details';summary.textContent='View details';
  try{const value=JSON.parse(pre.textContent),label=value.name||value.title||value.id||value.status;if(typeof label==='string')summary.textContent='Details · '+label}catch{}
  details.open=expanded.get(key)===true;details.addEventListener('toggle',()=>expanded.set(key,details.open));pre.replaceWith(details);details.append(summary,pre);
 });
}
