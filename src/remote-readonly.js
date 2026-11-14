/** Explicit opt-in read-only preview. Never persists tokens or writes records. */
import {createApiClient} from '../packages/api-client/index.js';
export function createReadOnlyConnection({fetchImpl=fetch}={}) {
  let api=null;
  let endpoint='';
  return {
    connect({baseUrl,accessToken}) {
      const url=new URL(baseUrl);
      if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw Error('HTTPS required for remote API');
      if(url.username||url.password||url.search||url.hash)throw Error('Use an API origin without credentials or query parameters');
      if(!accessToken||typeof accessToken!=='string')throw Error('An access token is required');
      const token=accessToken;
      api=createApiClient({baseUrl:url.origin,getAccessToken:()=>token,fetchImpl,readOnly:true});
      endpoint=url.origin;
    },
    disconnect(){api=null;endpoint=''},
    get connected(){return !!api},
    get endpoint(){return endpoint},
    async searchRecords(options){if(!api)throw Error('Not connected');return api.searchRecords(options)},
    async getSummary(){if(!api)throw Error('Not connected');return api.getSummary()}
  };
}
