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
  if(readOnly && method!=='GET' && !(path==='/v1/session'&&['POST','DELETE'].includes(method)))throw new ApiError('Read-only connection: record modifications are disabled',403);
  const token=await getAccessToken();
  if(!token)throw new ApiError('Sign in required',401);
  const response=await fetchImpl(base+path,{method,signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let payload;try{payload=await response.json()}catch{throw new ApiError('Invalid server response',response.status)}
  if(!response.ok)throw new ApiError(payload.error||'Request failed',response.status);
  return payload;
 }
 return {
  getOperationsDocument:options=>request('/v1/operations/document?'+new URLSearchParams(options)),
  getOperationsStatus:customerId=>request('/v1/operations/status?'+new URLSearchParams({customerId})),
  getOperationsTasks:(customerId,cursor='')=>request('/v1/operations/tasks?'+new URLSearchParams({customerId,cursor})),
  getOperationsHistory:(customerId,taskId)=>request('/v1/operations/history?'+new URLSearchParams({customerId,taskId})),
  installOperationsSample:input=>request('/v1/operations/sample',{method:'POST',body:input}),
  enqueueOperation:input=>request('/v1/operations/tasks',{method:'POST',body:input}),
  runOperations:input=>request('/v1/operations/run',{method:'POST',body:input}),
  controlOperation:input=>request('/v1/operations/control',{method:'POST',body:input}),
  getFieldWorkspace:customerId=>request('/v1/field/workspace?'+new URLSearchParams({customerId})),
  getFieldDrivers:customerId=>request('/v1/field/drivers?'+new URLSearchParams({customerId})),
  fieldCommand:input=>request('/v1/field/commands',{method:'POST',body:input}),
  fieldBilling:input=>request('/v1/field/billing',{method:'POST',body:input}),
  getCommercialWorkspace:customerId=>request('/v1/commercial/workspace?'+new URLSearchParams({customerId})),
  commercialCommand:input=>request('/v1/commercial/commands',{method:'POST',body:input}),
  getCustomerProfiles:()=>request('/v1/management/customers'),
  saveCustomerProfile:input=>request('/v1/management/customers',{method:'POST',body:input}),
  getManagementReport:options=>request('/v1/management/report?'+new URLSearchParams({...options,format:'json'})),
  getSyntheticUsers:()=>request('/v1/administration/users'),
  createSyntheticUser:input=>request('/v1/administration/users',{method:'POST',body:input}),
  setSyntheticUserState:input=>request('/v1/administration/account-state',{method:'POST',body:input}),
  getAcceptance:customerId=>request('/v1/administration/acceptance?'+new URLSearchParams({customerId})),
  recordAcceptance:input=>request('/v1/administration/acceptance?'+new URLSearchParams({customerId:input.customerId}),{method:'POST',body:input}),
  getIntegrationJobs:customerId=>request('/v1/management/integrations?'+new URLSearchParams({customerId})),
  getIntegrationJob:(customerId,id)=>request('/v1/management/integrations/'+encodeURIComponent(id)+'?'+new URLSearchParams({customerId})),
  stageIntegration:input=>request('/v1/management/integrations',{method:'POST',body:input}),
  getWorkspace:(customerId)=>request('/v1/sandbox/workspace?'+new URLSearchParams({customerId})),
  submitWarehouseCommand:(customerId,command)=>request('/v1/sandbox/commands',{method:'POST',body:{customerId,command}}),
  beginSession:()=>request('/v1/session',{method:'POST'}),
  endSession:()=>request('/v1/session',{method:'DELETE'}),
  getSession:()=>request('/v1/session'),
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
