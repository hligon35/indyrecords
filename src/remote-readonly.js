/** Source inventory stays read-only; session changes and local synthetic commands are explicitly gated. */
import {createApiClient} from '../packages/api-client/index.js';
export function createReadOnlyConnection({fetchImpl=fetch}={}) {
  let api=null;
  let endpoint='';
  let token=null;
  let generation=0;
  let user=null;
  function requireConnection(){if(!api)throw Error('Not connected');return api}
  async function read(method,...args){
    const current=generation;
    try{const result=await requireConnection()[method](...args);if(current!==generation)throw Error('Connection changed during request');return result}
    catch(error){if(current===generation&&error.status===401){generation++;token=null;api=null;endpoint='';user=null}throw error}
  }
  async function localManagementWrite(method,input){
   requireConnection();if(!['localhost','127.0.0.1'].includes(new URL(endpoint).hostname))throw Error('Changes require a local synthetic API');
   const current=generation,credential=token;
   try{const result=await createApiClient({baseUrl:endpoint,getAccessToken:()=>credential,fetchImpl,readOnly:false})[method](input);if(current!==generation)throw Error('Connection changed during request');return result}catch(error){if(current===generation&&error.status===401)connection.disconnect();throw error}
  }
  const connection={
    connect({baseUrl,accessToken}) {
      const url=new URL(baseUrl);
      if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw Error('HTTPS required for remote API');
      if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use an API origin without credentials, path or query parameters');
      if(!accessToken||typeof accessToken!=='string'||!accessToken.trim())throw Error('An access token is required');
      token=accessToken;
      endpoint=url.origin;
      generation++;
      api=createApiClient({baseUrl:endpoint,getAccessToken:()=>token,fetchImpl,readOnly:true});
    },
    disconnect(){generation++;token=null;api=null;endpoint='';user=null},
    async signIn(options){
      connection.connect(options);const current=generation;
      try{
        // Loopback shared-token demo remains usable without issuing user sessions.
        if(!token.startsWith('irm_session_')&&!['localhost','127.0.0.1'].includes(new URL(endpoint).hostname)){
          const session=await requireConnection().beginSession();
          if(current!==generation)throw Error('Connection changed during sign in');
          if(typeof session.accessToken!=='string'||!session.accessToken.startsWith('irm_session_'))throw Error('Invalid session response');
          token=session.accessToken;
        }
        return await connection.verifySession();
      }catch(error){if(current===generation)connection.disconnect();throw error}
    },
    async signOut(){
      const credential=token,baseUrl=endpoint;
      connection.disconnect();
      if(credential?.startsWith('irm_session_'))await createApiClient({baseUrl,getAccessToken:()=>credential,fetchImpl}).endSession();
    },
    async getWorkspace(customerId){return read('getWorkspace',customerId)},
    async submitSyntheticCommand(customerId,command){
      requireConnection();if(!['localhost','127.0.0.1'].includes(new URL(endpoint).hostname))throw Error('Warehouse changes require a local synthetic API');
      const current=generation;const credential=token;
      let result;try{result=await createApiClient({baseUrl:endpoint,getAccessToken:()=>credential,fetchImpl,readOnly:false}).submitWarehouseCommand(customerId,command)}catch(error){if(current===generation&&error.status===401)connection.disconnect();throw error}
      if(current!==generation)throw Error('Connection changed during request');return result;
    },
    async getCustomerProfiles(){return read('getCustomerProfiles')},
    async getManagementReport(options){return read('getManagementReport',options)},
    async getIntegrationJobs(customerId){return read('getIntegrationJobs',customerId)},
    async getIntegrationJob(customerId,id){return read('getIntegrationJob',customerId,id)},
    async saveCustomerProfile(input){return localManagementWrite('saveCustomerProfile',input)},
    async stageIntegration(input){return localManagementWrite('stageIntegration',input)},
    get user(){return user},
    get revision(){return generation},
    get connected(){return !!api},
    get endpoint(){return endpoint},
    async verifySession(){const session=await read('getSession');if(!session?.user?.id)throw Error('Invalid session response');user=session.user;return session},
    async searchRecords(options){return read('searchRecords',options)},
    async getRecord(barcode){return read('getRecord',barcode)},
    async getSummary(){return read('getSummary')},
    /** Paginate approved read-only inventory without persisting any records. */
    async *inventoryPages({q='',pageSize=50,maxPages=20,signal}={}) {
      if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw Error('pageSize must be 1 to 100');
      if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('maxPages must be 1 to 100');
      const currentGeneration=generation;
      requireConnection();
      let cursor='';
      const seen=new Set();
      for(let i=0;i<maxPages;i++){
        if(signal?.aborted)throw Error('Inventory search aborted');
        if(currentGeneration!==generation)throw Error('Connection changed during inventory search');
        const result=await read('searchRecords',{q,limit:pageSize,cursor,signal});
        if(currentGeneration!==generation)throw Error('Connection changed during inventory search');
        if(!result||!Array.isArray(result.items))throw Error('Invalid inventory response');
        yield result.items;
        if(!result.nextCursor)break;
        if(typeof result.nextCursor!=='string'||seen.has(result.nextCursor))throw Error('Invalid or repeated inventory cursor');
        seen.add(result.nextCursor);
        cursor=result.nextCursor;
      }
    }
  };
  return connection;
}
