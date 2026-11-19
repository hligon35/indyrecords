import test from 'node:test';
import assert from 'node:assert/strict';
import {previewLocationBypass,checkPunchLocation} from '../packages/time-clock/preview-policy.js';
const site={enabled:1};
const verify=()=>({allowed:false,reason:'OUTSIDE_GEOFENCE'});
test('offsite preview simulation may bypass when both flags explicitly enabled',()=>{
 const env={APP_ENV:'preview',ADP_MODE:'simulated',PREVIEW_DISABLE_GEOFENCE:'true',CLOCK_TESTING_ENABLED:'true'};
 assert.equal(previewLocationBypass(env),true);
 assert.equal(checkPunchLocation({site,env,verify}).reason,'PREVIEW_LOCATION_BYPASS');
});
test('production, gateway and missing flags always enforce geofence',()=>{
 for(const env of [
 {APP_ENV:'production',ADP_MODE:'simulated',PREVIEW_DISABLE_GEOFENCE:'true',CLOCK_TESTING_ENABLED:'true'},
 {APP_ENV:'preview',ADP_MODE:'gateway',PREVIEW_DISABLE_GEOFENCE:'true',CLOCK_TESTING_ENABLED:'true'},
 {APP_ENV:'preview',ADP_MODE:'simulated',PREVIEW_DISABLE_GEOFENCE:'true'},
 {APP_ENV:'preview',ADP_MODE:'simulated',PREVIEW_DISABLE_GEOFENCE:true,CLOCK_TESTING_ENABLED:'true'}
 ])assert.equal(checkPunchLocation({site,env,verify}).reason,'OUTSIDE_GEOFENCE');
});
test('disabled worksite remains disabled even in preview',()=>{
 const env={APP_ENV:'preview',ADP_MODE:'simulated',PREVIEW_DISABLE_GEOFENCE:'true',CLOCK_TESTING_ENABLED:'true'};
 assert.equal(checkPunchLocation({site:{enabled:0},env,verify}).reason,'WORKSITE_DISABLED');
});
