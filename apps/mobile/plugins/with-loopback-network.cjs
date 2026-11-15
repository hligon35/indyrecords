const {withAndroidManifest,withDangerousMod}=require('expo/config-plugins');
const {mkdir,copyFile}=require('node:fs/promises');
const path=require('node:path');
module.exports=function withLoopbackNetwork(config){
 config=withAndroidManifest(config,c=>{const app=c.modResults.manifest.application?.[0];if(!app)throw Error('Android application manifest is missing');app.$['android:networkSecurityConfig']='@xml/irm_loopback_network';return c});
 return withDangerousMod(config,['android',async c=>{const dir=path.join(c.modRequest.platformProjectRoot,'app/src/main/res/xml');await mkdir(dir,{recursive:true});await copyFile(path.join(__dirname,'../assets/irm_loopback_network.xml'),path.join(dir,'irm_loopback_network.xml'));return c}]);
};
