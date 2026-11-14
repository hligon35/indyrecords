import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
// Portable built-in font; non-ASCII code points are explicitly represented, never silently dropped.
const ascii=value=>String(value??'').replace(/[^\x20-\x7e]/gu,c=>c==='\n'||c==='\r'||c==='\t'?' ':'[U+'+c.codePointAt(0).toString(16).toUpperCase()+']');
function fit(value,font,size,width){let text=ascii(value);while(text.length&&font.widthOfTextAtSize(text,size)>width)text=text.slice(0,-1);return text}
function lines(value,font,size,width){
 let rest=ascii(value),result=[];
 while(rest&&result.length<4){let part=fit(rest,font,size,width);if(!part)break;const space=part.lastIndexOf(' ');if(part.length<rest.length&&space>part.length*.35)part=part.slice(0,space);result.push(part);rest=rest.slice(part.length).trimStart()}
 if(rest&&result.length){result[result.length-1]=fit(result.at(-1),font,size,width-font.widthOfTextAtSize('...',size))+'...'}
 return result.length?result:[''];
}
export async function reportPdf(report){
 const doc=await PDFDocument.create();doc.setTitle('IRM RMS '+report.type+' report');doc.setSubject('Synthetic/read-only scoped operational report');doc.setCreator('IRM RMS');
 const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const blue=rgb(.06,.15,.24),gray=rgb(.36,.43,.49),width=792,height=612,margin=36,tableWidth=720;
 const columns=report.columns;const cellWidth=tableWidth/columns.length;const pages=[];let page,y;
 const text=(value,x,at,size=9,type=font,color=blue)=>page.drawText(ascii(value),{x,y:at,size,font:type,color});
 function start(){page=doc.addPage([width,height]);pages.push(page);text('IRM RMS / '+report.type.toUpperCase(),margin,572,18,bold);text(report.synthetic?'SYNTHETIC DEMONSTRATION':'READ-ONLY SOURCE INVENTORY',margin,550,9,bold);text('Generated: '+report.generatedAt+' | Customers: '+report.customerIds.join(', '),margin,533,9);text('Rows: '+report.rows.length+' | Dates use UTC | Source: '+report.source,margin,518,9);text(fit('Filters: '+Object.entries(report.filters).filter(([,v])=>v).map(([k,v])=>k+'='+v).join(' | '),font,8,tableWidth),margin,503,8,font,gray);page.drawRectangle({x:margin,y:470,width:tableWidth,height:22,color:blue});columns.forEach(([,label],i)=>text(fit(label,bold,9,cellWidth-12),margin+i*cellWidth+6,478,9,bold,rgb(1,1,1)));y=464}
 start();
 if(!report.rows.length)text('No records match the selected scope and filters.',margin,y-20,11);
 for(const row of report.rows){
  const cells=columns.map(([key])=>lines(row[key],font,8,cellWidth-12));const rowHeight=Math.max(...cells.map(x=>x.length))*11+12;
  if(y-rowHeight<62)start();
  cells.forEach((cell,i)=>cell.forEach((line,n)=>text(line,margin+i*cellWidth+6,y-14-n*11,8)));
  page.drawLine({start:{x:margin,y:y-rowHeight},end:{x:margin+tableWidth,y:y-rowHeight},thickness:.4,color:rgb(.82,.86,.89)});y-=rowHeight;
 }
 pages.forEach((item,index)=>{page=item;text('Values over four lines are shortened; CSV retains full values. Non-ASCII text uses U+ notation.',margin,32,8,font,gray);text('Page '+(index+1)+' of '+pages.length,680,32,8,font,gray)});
 return doc.save();
}
