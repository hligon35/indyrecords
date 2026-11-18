export const DEFAULT_RADIUS_FEET=500;
export const MIN_RADIUS_FEET=100;
export const MAX_RADIUS_FEET=2000;
export const MAX_ACCURACY_METERS=50;
export const FEET_PER_METER=3.280839895;
export function distanceMeters(a,b){
 const rad=Math.PI/180, dLat=(b.lat-a.lat)*rad, dLon=(b.lon-a.lon)*rad;
 const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
 return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function validateRadius(value){
 if(!Number.isInteger(value)||value<MIN_RADIUS_FEET||value>MAX_RADIUS_FEET)throw Error('Radius must be an integer between 100 and 2000 feet');
 return value;
}
export function validateCoordinate(lat,lon){
 if(typeof lat!=='number'||typeof lon!=='number'||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Invalid coordinates');
}
export function verifyGeofence({site,location,now=Date.now()}){
 if(!site?.enabled)return {allowed:false,reason:'WORKSITE_DISABLED'};
 if(!site.geofence_enabled)return {allowed:true,reason:'GEOFENCE_DISABLED',distanceFeet:null};
 const {latitude,longitude,accuracyMeters,capturedAt}=location||{};
 try{validateCoordinate(latitude,longitude)}catch{return {allowed:false,reason:'INVALID_LOCATION'};}
 if(!Number.isFinite(accuracyMeters)||accuracyMeters<0||accuracyMeters>MAX_ACCURACY_METERS)return {allowed:false,reason:'LOCATION_INACCURATE'};
 if(!Number.isFinite(capturedAt)||Math.abs(now-capturedAt)>60000)return {allowed:false,reason:'LOCATION_STALE'};
 const distanceFeet=distanceMeters({lat:site.latitude,lon:site.longitude},{lat:latitude,lon:longitude})*FEET_PER_METER;
 const allowed=distanceFeet+accuracyMeters*FEET_PER_METER<=site.radius_feet;
 return {allowed,reason:allowed?'INSIDE_GEOFENCE':'OUTSIDE_GEOFENCE',distanceFeet:Math.round(distanceFeet),accuracyFeet:Math.round(accuracyMeters*FEET_PER_METER)};
}
export function validatePunchType(type){if(!['IN','OUT','BREAK_START','BREAK_END'].includes(type))throw Error('Unsupported punch type');return type;}
