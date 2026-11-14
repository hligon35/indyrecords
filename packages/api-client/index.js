/**
 * Shared API client for trusted/native callers.
 * Do not embed a shared DEMO_API_TOKEN in web, mobile or desktop builds.
 */
export class ApiError extends Error {
 constructor(message,status){super(message);this.name='ApiError';this.status=status}
}
export function createApiClient({baseUrl,getAccessToken,fetchImpl=fetch,readOnly=true}){
 const parsed=new URL(baseUrl);
 if(parsed.protocol!=='https:' && !(parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname)))throw Error('HTTPS API origin required');
 if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw Error('API URL must be a clean origin');
 if(typeof getAccessToken!=='function')throw Error('getAccessToken callback required');
 const base=parsed.origin;
 async function request(path,{method='GET',body,signal}={}){
  if(readOnly && method!=='GET')throw new ApiError('Read-only connection: record modifications are disabled',403);
  const token=await getAccessToken();
  if(!token)throw new ApiError('Sign in required',401);
  const response=await fetchImpl(base+path,{method,signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let payload;try{payload=await response.json()}catch{throw new ApiError('Invalid server response',response.status)}
  if(!response.ok)throw new ApiError(payload.error||'Request failed',response.status);
  return payload;
 }
 return {
  searchRecords:({q='',limit=25,cursor='',signal}={})=>request('/v1/records?'+new URLSearchParams({q:String(q),limit:String(limit),cursor:String(cursor)}),{signal}),
  getRecord:(barcode)=>request('/v1/records/'+encodeURIComponent(barcode)),
  submitScan:(scan)=>request('/v1/scans',{method:'POST',body:scan}),
  getSummary:()=>request('/v1/reports/summary')
 };
}
export function classifyScanFailure(error){
 if(!(error instanceof ApiError))return 'retry';
 if(error.status===401||error.status===403)return 'reauthenticate';
 if([400,404,409,422,501].includes(error.status))return 'conflict';
 if(error.status===429||error.status>=500)return 'retry';
 return 'conflict';
}
