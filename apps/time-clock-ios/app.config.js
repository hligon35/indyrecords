const raw=process.env.EXPO_PUBLIC_CLOCK_URL||'';
let url=null;
try {
 const parsed=new URL(raw);
 if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash)url=parsed.origin;
} catch {}
const projectId=process.env.EAS_PROJECT_ID||'209c40ab-a4b8-4bca-b42f-c15bd5d0c2f9';
module.exports={
 expo:{
   name:'IRM Time Clock',
   slug:'irm-time-clock',
   scheme:'irmtimeclock',
   version:'0.1.0',
   icon:'./assets/irm-time-clock-icon.png',
   orientation:'portrait',
   userInterfaceStyle:'automatic',
   ios:{
     bundleIdentifier:'com.alphazonelabs.irmtimeclock',
     supportsTablet:true,
     icon:'./assets/irm-time-clock-icon.png',
     infoPlist:{
       NSLocationWhenInUseUsageDescription:'IRM Time Clock uses your location only when you submit a punch to verify the assigned worksite.',
       NSAppTransportSecurity:{NSAllowsArbitraryLoads:false}
     }
   },
   plugins:[],
   runtimeVersion:{policy:'appVersion'},
   updates:{url:projectId?'https://u.expo.dev/'+projectId:undefined},
   extra:{
     clockUrl:url,
     eas:projectId?{projectId}:undefined,
     previewOnly:true
   }
 }
};
