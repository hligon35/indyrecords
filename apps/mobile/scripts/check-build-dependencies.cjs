// Validate the exact API consumed by Metro after security dependency overrides.
const assert=require('node:assert/strict');
// Exercise Expo's preload order as well as fresh worker imports.
require('metro/private/Assets');
require('./image-size-compat.cjs');
const imageSize=require('image-size').default;
const {getAssetSize}=require('metro/private/Assets');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
assert.equal(typeof imageSize,'function');assert.equal(imageSize(png).width,1);
assert.deepEqual(getAssetSize('png',png,'synthetic.png'),{width:1,height:1});
assert.throws(()=>imageSize(Buffer.from('not an image')));
const postcss=require('postcss');assert.match(postcss.parse('a { color: blue; }').toString(),/blue/);
console.log('PASS: patched image-size and PostCSS APIs remain compatible with Metro.');
const {getAssetData}=require('metro/private/Assets');
const path=require('node:path');
getAssetData(path.join(__dirname,'../assets/irm-app-icon.png'),'assets/irm-app-icon.png',[],null,'/assets').then(asset=>{
 assert.equal(asset.width,1024);assert.equal(asset.height,1024);
 console.log('PASS: full Metro asset pipeline measures the IRM PNG by file path.');
}).catch(error=>{console.error(error);process.exitCode=1});
