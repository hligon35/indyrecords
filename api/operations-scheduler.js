import {runTasks} from './operations-tasks.js';
import {runReportExports} from './report-exports.js';
import {refreshAlerts} from './operations-monitor.js';
// No cron is deployed by this module. Explicit opt-in is required for fixture processing.
export async function scheduledOperations(env,now=Date.now()){
 if(env.SYNTHETIC_OPERATIONS_SCHEDULER_ENABLED!=='true'||env.SYNTHETIC_OPERATIONS_ENABLED!=='true')return {disabled:true};
 const tenants=[];
 for(const customerId of ['c1','c2','c3','c4']){
  const tasks=await runTasks(env,customerId,{limit:5,now}),reports=await runReportExports(env,customerId,{limit:5,now});
  await refreshAlerts(env.DB,customerId,now);tenants.push({customerId,...tasks,reports});
 }
 return {synthetic:true,tenants};
}
