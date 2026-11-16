import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {notoSansBase64} from '../../assets/fonts/noto-sans.js';

const WIDTH=792,HEIGHT=612,MARGIN=36,TABLE_WIDTH=720,LINE_HEIGHT=10,MAX_PAGES=200;
let fontBytes;
function fontData(){fontBytes??=Uint8Array.from(atob(notoSansBase64),c=>c.charCodeAt(0));return fontBytes}
function normalize(value){return String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ')}
function supportedText(value,supported){for(const character of String(value??''))if(!['\n','\r','\t'].includes(character)&&!supported.has(character.codePointAt(0)))throw Error('PDF font does not support U+'+character.codePointAt(0).toString(16).toUpperCase()+'; use UTF-8 CSV or HTML')}
function wrap(value,font,size,width){
 const result=[];
 for(const paragraph of normalize(value).split('\n')){
  if(!paragraph){result.push('');continue}
  let line='';
  for(const word of paragraph.split(/(\s+)/u)){
   if(!word)continue;
   if(line&&font.widthOfTextAtSize(line+word,size)>width){result.push(line.trimEnd());line=''}
   if(font.widthOfTextAtSize(word,size)<=width){line+=word;continue}
   for(const character of word){if(line&&font.widthOfTextAtSize(line+character,size)>width){result.push(line.trimEnd());line=''}line+=character}
  }
  if(line)result.push(line.trimEnd());
 }
 return result.length?result:[''];
}
function metadata(report){return [
 ['Generated',report.generatedAt],
 ['Customers',report.customerIds.join(', ')],
 ['Rows',report.rows.length+' · Source '+report.source],
 ['Filters',Object.entries(report.filters).filter(([,value])=>value).map(([key,value])=>key+'='+value).join(' · ')||'None']
]}

export async function reportPdf(report){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(fontData(),{subset:true}),supported=new Set(font.getCharacterSet());
 const allText=[report.type,report.generatedAt,report.source,...report.customerIds,...report.columns.map(([,label])=>label),...metadata(report).flatMap(([,value])=>[value]),...report.rows.flatMap(row=>report.columns.map(([key])=>row[key]))];
 for(const value of allText)supportedText(value,supported);
 doc.setTitle('IRM RMS '+report.type+' report');doc.setSubject('Scoped operational report');doc.setCreator('IRM RMS');
 const ink=rgb(.06,.15,.24),muted=rgb(.36,.43,.49),rule=rgb(.82,.86,.89),white=rgb(1,1,1);
 const cellWidth=TABLE_WIDTH/report.columns.length,pages=[];let page,y;
 function text(value,x,at,size=8,color=ink){page.drawText(String(value),{x,y:at,size,font,color})}
 function newPage(){
  if(pages.length>=MAX_PAGES)throw Error('PDF exceeds 200 pages; narrow the report or use CSV');
  page=doc.addPage([WIDTH,HEIGHT]);pages.push(page);
  text('IRM RMS / '+report.type.toUpperCase(),MARGIN,576,17);
  text(report.synthetic?'SYNTHETIC DEMONSTRATION':'READ-ONLY SOURCE INVENTORY',MARGIN,557,8,muted);
  let metaY=540;
  for(const [label,value] of metadata(report)){
   const wrapped=wrap(label+': '+value,font,7,TABLE_WIDTH);
   for(const line of wrapped){text(line,MARGIN,metaY,7,muted);metaY-=9}
  }
  y=Math.min(496,metaY-7);
  page.drawRectangle({x:MARGIN,y:y-20,width:TABLE_WIDTH,height:22,color:ink});
  report.columns.forEach(([,label],index)=>{
   const lines=wrap(label,font,8,cellWidth-10);
   lines.slice(0,2).forEach((line,lineIndex)=>text(line,MARGIN+index*cellWidth+5,y-12-lineIndex*9,8,white));
  });
  y-=24;
 }
 newPage();
 if(!report.rows.length)text('No records match the selected scope and filters.',MARGIN,y-14,10);
 for(const row of report.rows){
  const cells=report.columns.map(([key])=>wrap(row[key]??'',font,7,cellWidth-10));
  let remaining=cells.map(lines=>[...lines]);
  while(remaining.some(lines=>lines.length)){
   const linesAvailable=Math.max(1,Math.floor((y-58-8)/LINE_HEIGHT));
   const chunk=remaining.map(lines=>lines.splice(0,linesAvailable));
   const rowLines=Math.max(1,...chunk.map(lines=>lines.length)),rowHeight=rowLines*LINE_HEIGHT+8;
   chunk.forEach((lines,index)=>lines.forEach((line,lineIndex)=>text(line,MARGIN+index*cellWidth+5,y-12-lineIndex*LINE_HEIGHT,7)));
   page.drawLine({start:{x:MARGIN,y:y-rowHeight},end:{x:MARGIN+TABLE_WIDTH,y:y-rowHeight},thickness:.4,color:rule});y-=rowHeight;
   if(remaining.some(lines=>lines.length))newPage();
   else if(y<66&&report.rows.indexOf(row)<report.rows.length-1)newPage();
  }
 }
 pages.forEach((item,index)=>{
  page=item;
  page.drawText('All report values shown. Spreadsheet-safe full values are available in CSV.',{x:MARGIN,y:30,size:7,font,color:muted});
  page.drawText('Page '+(index+1)+' of '+pages.length,{x:680,y:30,size:7,font,color:muted});
 });
 return doc.save();
}
