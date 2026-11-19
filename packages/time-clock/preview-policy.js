// Preview geofence bypass is server-side, never controlled by client payloads.
// It is safe only when the entire deployment is an isolated simulation.
export function previewLocationBypass(env){
 return env?.APP_ENV==='preview' && env?.ADP_MODE==='simulated' &&
        env?.PREVIEW_DISABLE_GEOFENCE==='true' && env?.CLOCK_TESTING_ENABLED==='true';
}
export function checkPunchLocation({site,location,env,verify}){
 if(!site?.enabled)return {allowed:false,reason:'WORKSITE_DISABLED'};
 if(previewLocationBypass(env))return {allowed:true,reason:'PREVIEW_LOCATION_BYPASS',distanceFeet:null,accuracyFeet:null,simulated:true};
 return verify({site,location});
}
