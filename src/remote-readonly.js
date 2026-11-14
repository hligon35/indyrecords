/** Explicit opt-in read-only connection. No persistent credentials or write methods. */
import {createApiClient} from '../packages/api-client/index.js';
export function createReadOnlyConnection({fetchImpl=fetch}={}) {
  let api=null;
  let endpoint='';
  let token=null;
  let generation=0;
  function requireConnection(){if(!api)throw Error('Not connected');return api}
  return {
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
    disconnect(){generation++;token=null;api=null;endpoint=''},
    get connected(){return !!api},
    get endpoint(){return endpoint},
    async searchRecords(options){return requireConnection().searchRecords(options)},
    async getRecord(barcode){return requireConnection().getRecord(barcode)},
    async getSummary(){return requireConnection().getSummary()},
    /** Paginate approved read-only inventory without persisting any records. */
    async *inventoryPages({q='',pageSize=50,maxPages=20,signal}={}) {
      if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw Error('pageSize must be 1 to 100');
      if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('maxPages must be 1 to 100');
      const currentGeneration=generation;
      const client=requireConnection();
      let cursor='';
      const seen=new Set();
      for(let i=0;i<maxPages;i++){
        if(signal?.aborted)throw Error('Inventory search aborted');
        if(currentGeneration!==generation)throw Error('Connection changed during inventory search');
        const result=await client.searchRecords({q,limit:pageSize,cursor,signal});
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
}
