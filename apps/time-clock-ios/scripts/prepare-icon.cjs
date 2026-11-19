// Normalizes a pre-rounded icon before iOS applies its own shape mask.
// Only flood-fills bright neutral pixels connected to the image border;
// isolated white artwork (such as the IRM lettering) is left untouched.
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');

const icon=path.join(__dirname,'..','assets','irm-time-clock-icon.png');
const navy=[6,29,54];
async function main(){
 if(!fs.existsSync(icon))throw Error('Icon missing: '+icon);
 const {data,info}=await sharp(icon).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==1024||info.height!==1024||info.channels!==4)throw Error('Icon must be a 1024x1024 PNG before preparation.');
 const width=info.width,height=info.height,pixels=width*height;
 const visited=new Uint8Array(pixels);
 const stack=new Int32Array(pixels);let top=0;
 const exterior=i=>{
  const n=i*4,r=data[n],g=data[n+1],b=data[n+2],a=data[n+3];
  return a<220||(r>=178&&g>=178&&b>=178&&Math.max(r,g,b)-Math.min(r,g,b)<36);
 };
 const push=i=>{if(!visited[i]&&exterior(i)){visited[i]=1;stack[top++]=i;}};
 for(let x=0;x<width;x++){push(x);push((height-1)*width+x);}
 for(let y=0;y<height;y++){push(y*width);push(y*width+width-1);}
 let count=0;
 while(top){
  const i=stack[--top],p=i*4;count++;
  data[p]=navy[0];data[p+1]=navy[1];data[p+2]=navy[2];data[p+3]=255;
  const x=i%width,y=(i-x)/width;
  if(x>0)push(i-1);
  if(x<width-1)push(i+1);
  if(y>0)push(i-width);
  if(y<height-1)push(i+width);
 }
 // For any remaining transparent pixels, use a solid navy background.
 // iOS applies the rounded mask; the supplied artwork must be square/full bleed.
 const png=await sharp(data,{raw:{width,height,channels:4}}).flatten({background:{r:navy[0],g:navy[1],b:navy[2]}}).removeAlpha().png().toBuffer();
 fs.writeFileSync(icon,png);
 console.log('Prepared full-bleed iOS icon: '+width+'x'+height+', border/background pixels normalized: '+count);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
