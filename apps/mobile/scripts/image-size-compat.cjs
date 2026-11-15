// Metro in SDK 54 accepts a file path; the patched image-size v2 API accepts bytes.
// Adapt that boundary in memory in both Metro and its workers, retaining v2 validation.
const {readFileSync}=require('node:fs');
const location=require.resolve('image-size');
const original=require(location);
if(!original.irmPathCompatibility){
 const measure=original.imageSize||original.default;
 const compatible=input=>measure(typeof input==='string'?readFileSync(input):input);
 // Expo's supervisor may have already loaded Assets. Preserve that object identity.
 Object.defineProperty(original,'default',{value:compatible,writable:true,configurable:true,enumerable:true});
 Object.defineProperty(original,'imageSize',{value:compatible,writable:true,configurable:true,enumerable:true});
 Object.defineProperty(original,'irmPathCompatibility',{value:true});
}
