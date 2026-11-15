import {runTasks} from './operations-tasks.js';
// No cron is deployed by this module. Explicit opt-in is required for fixture processing.
export async function scheduledOperations(env,now=Date.now()){
 if(env.SYNTHETIC_OPERATIONS_SCHEDULER_ENABLED!=='true'||env.SYNTHETIC_OPERATIONS_ENABLED!=='true')return {disabled:true};
 const tenants=[];
 for(const customerId of ['c1','c2','c3','c4'])tenants.push({customerId,...await runTasks(env,customerId,{limit:10,now})});
 return {synthetic:true,tenants};
}
