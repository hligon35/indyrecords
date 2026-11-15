import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {notoSansBase64} from '../../assets/fonts/noto-sans.js';
import {invoiceBalance} from '../commercial/workflows.js';
import {csvCell} from '../reports/report.js';
import {verifyFieldCustody} from '../field/workflows.js';
const fail=(m,status=422)=>{throw Object.assign(Error(m),{status})};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'$'+(n/100).toFixed(2)+' USD';
const row=(label,value)=>({label,value:String(value??'')});
export async function buildDocument({commercial,field,warehouse},type,id,now=new Date().toISOString()){
 const customerId=commercial.customerId;
 if(!commercial.synthetic||!field.synthetic||!warehouse.synthetic||[field.customerId,warehouse.customerId].some(t=>t!==customerId))fail('Customer workspaces do not match',403);
 const document={schemaVersion:1,synthetic:true,customerId,type,reference:id||customerId,generatedAt:now,title:'SAMPLE / NOT FOR OPERATIONAL USE',sections:[]};
 if(type==='invoice'){
  const invoice=commercial.invoices.find(i=>i.id===id);if(!invoice)fail('Invoice not found',404);
  document.title='SAMPLE INVOICE / NO PAYMENT REQUEST';
  const account=commercial.accounts.find(a=>a.id===invoice.accountId), balance=invoiceBalance(commercial,invoice);
  document.sections.push({title:'Billing details',rows:[row('Invoice',invoice.id),row('Account',account?.name),row('Status',invoice.status),row('Service period',invoice.from+' through '+invoice.to),row('Due date',invoice.due),row('Billing snapshot',JSON.stringify(invoice.billTo))]});
  document.sections.push({title:'Service lines',rows:invoice.lines.map((l,n)=>row('Line '+(n+1),JSON.stringify(l)))});
  document.sections.push({title:'Totals',rows:[row('Total',money(invoice.totalCents)),row('Credits',money(balance.creditCents)),row('Net payments',money(balance.paidCents)),row('Outstanding',money(balance.dueCents)),...invoice.credits.map(c=>row('Credit '+c.id,money(c.amountCents)+' '+c.reason))]});
 }else if(type==='certificate'){
  const certificate=field.certificates.find(c=>c.id===id);if(!certificate)fail('Certificate not found',404);
  if(!await verifyFieldCustody(field.custody))fail('Custody integrity failed; certificate output blocked',409);
  const job=field.jobs.find(j=>j.id===certificate.jobId);
  document.title='SAMPLE / NOT PROOF OF DESTRUCTION';
  document.sections.push({title:certificate.voided?'VOIDED SAMPLE - retained history':'Sample certificate',rows:[row('Reference',certificate.id),row('Revision',certificate.revision),row('Issued at',certificate.issuedAt),row('Issuer',certificate.issuer),row('Void reason',certificate.voidReason||'Not voided'),row('Job',job.id),row('Location',job.address),row('Production',certificate.production),row('Containers',certificate.bins.join(', ')),row('Custody head',certificate.custodyHead),row('Authorization actor',job.authorization?.actor),row('Performer',job.performed?.actor)]});
  document.sections.push({title:'Custody evidence',rows:field.custody.filter(e=>e.jobId===job.id).map(e=>row(e.action,`${e.at} | ${e.actor} | ${JSON.stringify(e.data)} | ${e.hash}`))});
 }else if(type==='operations'){
  document.title='SAMPLE OPERATIONS REPORT';
  document.sections.push({title:'Accounts',rows:commercial.accounts.map(a=>row(a.id,`${a.name} | ${a.stage} | archived=${a.archived}`))});
  document.sections.push({title:'Warehouse inventory',rows:warehouse.records.map(r=>row(r.barcode,`${r.kind} | ${r.status} | ${r.location||''} | ${r.custodian}`))});
  document.sections.push({title:'Field jobs',rows:field.jobs.map(j=>row(j.id,`${j.name} | ${j.date} | ${j.status} | ${j.address} | production=${j.production}`))});
  document.sections.push({title:'Issued receivables',rows:commercial.invoices.filter(i=>i.status==='issued').map(i=>row(i.id,money(invoiceBalance(commercial,i).dueCents)))});
 }else fail('Unsupported document type',400);
 if(JSON.stringify(document).length>1500000)fail('Document exceeds synthetic output limit',413);
 return document;
}
export function documentHtml(doc){
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>'+esc(doc.title)+'</title><style>body{font:14px system-ui,sans-serif;margin:2rem;color:#10253c}h1{font-size:22px;color:#a00}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;text-align:left;vertical-align:top;padding:8px;overflow-wrap:anywhere;white-space:pre-wrap}th{width:24%}@media print{body{margin:1cm}tr{break-inside:avoid}}</style><h1>'+esc(doc.title)+'</h1><p>Synthetic records only. No payment, real destruction or compliance certification is established by this document.</p><p>'+esc(doc.customerId)+' | '+esc(doc.reference)+' | '+esc(doc.generatedAt)+'</p>'+doc.sections.map(s=>'<h2>'+esc(s.title)+'</h2><table>'+s.rows.map(r=>'<tr><th>'+esc(r.label)+'</th><td>'+esc(r.value)+'</td></tr>').join('')+'</table>').join('')+'</html>';
}
export function documentCsv(doc){return '\uFEFF'+[['Customer','Document','Section','Field','Value'],...doc.sections.flatMap(s=>s.rows.map(r=>[doc.customerId,doc.reference,s.title,r.label,r.value]))].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n'}
let fontBytes;
export async function documentPdf(doc){
 fontBytes??=Uint8Array.from(atob(notoSansBase64),c=>c.charCodeAt(0));
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const font=await pdf.embedFont(fontBytes,{subset:true}), supported=new Set(font.getCharacterSet());
 const allText=[doc.title,doc.customerId,doc.reference,doc.generatedAt,...doc.sections.flatMap(s=>[s.title,...s.rows.flatMap(r=>[r.label,r.value])])].join('\n');
 for(const char of allText)if(!['\n','\r','\t'].includes(char)&&!supported.has(char.codePointAt(0)))fail('PDF font does not support U+'+char.codePointAt(0).toString(16).toUpperCase()+'; use UTF-8 HTML/CSV');
 pdf.setTitle(doc.title);pdf.setSubject('Synthetic document; not legal, payment or destruction evidence');pdf.setCreator('IRM RMS');
 const pages=[];let page,y;
 function start(){if(pages.length>=200)fail('PDF exceeds 200-page synthetic limit; use CSV',413);page=pdf.addPage([612,792]);pages.push(page);page.drawText(doc.title,{x:36,y:752,size:14,font,color:rgb(.6,0,0)});page.drawText('IRM RMS | '+doc.customerId+' | SYNTHETIC ONLY',{x:36,y:730,size:9,font});y=704}
 function write(value,size=10,color=rgb(.06,.15,.24)){
  const paragraphs=String(value).replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n');
  for(const paragraph of paragraphs){let line='';const lines=[];for(const ch of paragraph){if(line&&font.widthOfTextAtSize(line+ch,size)>540){lines.push(line);line=''}line+=ch}lines.push(line);for(const text of lines){if(y<62)start();page.drawText(text,{x:36,y,size,font,color});y-=size+5}}
 }
 start();write('Reference: '+doc.reference,9);write('Generated: '+doc.generatedAt,9);write('No payment request or operational certification is created.',9);y-=8;
 for(const section of doc.sections){if(y<100)start();y-=8;write(section.title,12);for(const r of section.rows){write(r.label+': '+r.value,9);y-=3}}
 pages.forEach((p,n)=>p.drawText('SAMPLE | Page '+(n+1)+' of '+pages.length,{x:36,y:30,size:8,font}));
 return pdf.save();
}
