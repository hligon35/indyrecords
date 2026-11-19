const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'..','assets','irm-time-clock-icon.png');
function fail(reason){console.error('IRM Time Clock icon verification failed: '+reason);process.exitCode=1;}
if(!fs.existsSync(file)){fail('Missing '+file+'. Copy the supplied branded PNG into apps/time-clock-ios/assets/ before building.');}
else {
 const data=fs.readFileSync(file);
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 if(data.length<24||!data.subarray(0,8).equals(signature))fail('Expected a PNG file.');
 else {
  const w=data.readUInt32BE(16),h=data.readUInt32BE(20);
  if(w!==1024||h!==1024)fail('Expected a 1024 x 1024 PNG, received '+w+' x '+h+'.');
  else console.log('IRM Time Clock icon verified: 1024 x 1024 PNG.');
 }
}
