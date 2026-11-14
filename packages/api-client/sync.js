import {nextBatch,markSending,acknowledge,recoverInterrupted} from '../../src/sync-queue.js';
import {classifyScanFailure} from './index.js';

/**
 * Platform-independent single-flight synchronization runner.
 * Caller supplies a durable repository (read/write) and authenticated API.
 * A production adapter must make queue writes transactional and durable.
 */
export function createSyncCoordinator({repository,api,clock=()=>Date.now(),onState=()=>{}}){
 if(!repository||typeof repository.read!=='function'||typeof repository.write!=='function')throw Error('Queue repository required');
 if(!api||typeof api.submitScan!=='function')throw Error('API required');
 let running=false;
 async function synchronize({limit=25}={}){
  if(running)return {status:'busy',processed:0};
  running=true;
  let processed=0;
  try{
   let queue=recoverInterrupted(await repository.read());
   await repository.write(queue);
   const batch=nextBatch(queue,clock(),limit);
   for(const event of batch){
    queue=markSending(queue,[event.clientEventId]);
    await repository.write(queue);
    onState({clientEventId:event.clientEventId,status:'sending'});
    try{
     const result=await api.submitScan(event.command?{clientEventId:event.clientEventId,customerId:event.customerId,actorId:event.actorId,command:event.command}:{
      clientEventId:event.clientEventId,
      barcode:event.barcode,
      operation:event.operation,
      mode:event.mode,
      occurredAt:event.occurredAt,
      ...(event.workOrderId?{workOrderId:event.workOrderId}:{})
     });
     if(result.status!=='accepted'&&result.status!=='already_accepted')throw Error('Unexpected server acknowledgement');
     queue=acknowledge(queue,event.clientEventId,result.status,clock());
     await repository.write(queue);
     onState({clientEventId:event.clientEventId,status:'confirmed'});
     processed++;
    }catch(error){
     const kind=classifyScanFailure(error);
     queue=queue.map(x=>x.clientEventId===event.clientEventId?{...x,lastError:String(error.message||'Synchronization failed').slice(0,200),lastStatus:error.status||null}:x);
     if(kind==='reauthenticate'){
      queue=acknowledge(queue,event.clientEventId,'retry',clock());
      await repository.write(queue);
      onState({clientEventId:event.clientEventId,status:'auth-required'});
      return {status:'auth-required',processed};
     }
     queue=acknowledge(queue,event.clientEventId,kind==='conflict'?'conflict':'retry',clock());
     await repository.write(queue);
     onState({clientEventId:event.clientEventId,status:kind});
     processed++;
    }
   }
   return {status:'complete',processed};
  }finally{running=false}
 }
 return {synchronize,isRunning:()=>running};
}
