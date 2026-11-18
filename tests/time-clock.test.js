import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_RADIUS_FEET,validateRadius,distanceMeters,verifyGeofence} from '../packages/time-clock/policy.js';
const site={id:'test',latitude:39.7684,longitude:-86.1581,radius_feet:500,enabled:1,geofence_enabled:1};
const loc=(lat=site.latitude,accuracyMeters=5,capturedAt=Date.now())=>({latitude:lat,longitude:site.longitude,accuracyMeters,capturedAt});
test('default 500-foot geofence and admin bounds',()=>{
 assert.equal(DEFAULT_RADIUS_FEET,500);
 for(const x of [100,500,2000])assert.equal(validateRadius(x),x);
 for(const x of [0,99,2001,500.5,NaN])assert.throws(()=>validateRadius(x));
});
test('geofence allows accurate on-site location',()=>assert.equal(verifyGeofence({site,location:loc()}).allowed,true));
test('geofence rejects outside worksite',()=>assert.equal(verifyGeofence({site,location:loc(site.latitude+0.003)}).reason,'OUTSIDE_GEOFENCE'));
test('geofence boundary accounts for GPS uncertainty',()=>{
 const dLat=130/364000; // ~130 feet
 assert.equal(verifyGeofence({site,location:loc(site.latitude+dLat,5)}).allowed,true);
 const nearEdge=490/364000;
 assert.equal(verifyGeofence({site,location:loc(site.latitude+nearEdge,15)}).allowed,false);
});
test('custom radius is enforced per site',()=>{
 const target=loc(site.latitude+0.002);
 assert.equal(verifyGeofence({site,location:target}).allowed,false);
 assert.equal(verifyGeofence({site:{...site,radius_feet:1500},location:target}).allowed,true);
});
test('stale, poor accuracy and invalid locations deny',()=>{
 assert.equal(verifyGeofence({site,location:loc(site.latitude,51)}).reason,'LOCATION_INACCURATE');
 assert.equal(verifyGeofence({site,location:loc(site.latitude,5,Date.now()-70000)}).reason,'LOCATION_STALE');
 assert.equal(verifyGeofence({site,location:loc(130)}).reason,'INVALID_LOCATION');
});
test('site policy distinguishes disabled from closed worksite',()=>{
 assert.equal(verifyGeofence({site:{...site,geofence_enabled:0},location:null}).allowed,true);
 assert.equal(verifyGeofence({site:{...site,enabled:0,geofence_enabled:0},location:null}).allowed,false);
});
test('distance is zero at same coordinates',()=>assert.equal(distanceMeters({lat:site.latitude,lon:site.longitude},{lat:site.latitude,lon:site.longitude}),0));
