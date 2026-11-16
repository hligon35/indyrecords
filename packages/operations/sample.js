import {seedCommercial, applyCommercial} from '../commercial/workflows.js';
import {seedField, applyField} from '../field/workflows.js';
import {seedWarehouse, applyWarehouseCommand} from '../warehouse/workflows.js';

export const DATASET_VERSION = 'irm-full-sample-v3';
export const SAMPLE_DAY = '2026-11-15';
export const sampleDriver = tenant => `demo-user-sample-${tenant}-driver`;
const at = '2026-11-15T15:00:00.000Z';
const supervisor = 'demo-sample-supervisor';
export async function buildSampleDataset(customerId) {
  if (!['c1','c2','c3','c4'].includes(customerId)) throw Error('Synthetic tenant required');
  let commercial = seedCommercial(customerId), field = seedField(customerId), warehouse = seedWarehouse(customerId);
  let sequence = 0;
  const id = label => `demo-${customerId}-${label}-${++sequence}`;
  function office(type, input = {}, when=at) {
    const key = id(type.replaceAll('_','-'));
    commercial = applyCommercial(commercial, {id:key,type,input,expectedVersion:commercial.version}, supervisor, when).state;
    return key;
  }
  async function drive(type,input={},actor=supervisor,when=at) {
    const key=id(type.replaceAll('_','-')), job=field.jobs.find(j=>j.id===input.jobId);
    field=(await applyField(field,{clientEventId:key,type,input,expectedVersion:field.version,expectedJobVersion:job?.version},actor,when)).state;
    return key;
  }
  async function store(type,input={}) {
    const record=warehouse.records.find(r=>r.barcode===input.barcode), order=warehouse.orders.find(o=>o.id===input.orderId);
    warehouse=(await applyWarehouseCommand(warehouse,{clientEventId:id(type),type,expectedVersion:record?.version,orderVersion:order?.version,...input},supervisor,at)).state;
  }
  const accountId=office('create_account',{name:`Demo ${customerId} Records & Shredding — Café`});
  office('convert_account',{accountId});
  const contactId=office('add_contact',{accountId,name:'Demo Morgan Rivera',alias:'demo-billing'});
  const locations=[];
  for(let n=1;n<=2;n++)locations.push(office('add_location',{accountId,name:`Demo Branch ${n}`,address:`${n*100} Fictional Avenue`,timezone:n===1?'America/Indiana/Indianapolis':'America/Chicago',windowStart:'08:00',windowEnd:'17:00'}));
  office('set_billing',{accountId,locationId:locations[0],contactId});
  office('log_interaction',{accountId,note:'Demo service review: recurring bins and one-time purge.'});
  const taskId=office('create_task',{accountId,title:'Demo renewal review',assignee:supervisor,due:'2026-11-20'});
  office('complete_task',{taskId});
  office('create_task',{accountId,title:'Demo follow-up still open',assignee:supervisor,due:'2026-11-18'});
  const prospectId=office('create_account',{name:`Demo ${customerId} Prospect`});
  const prospectLocation=office('add_location',{accountId:prospectId,name:'Demo Prospect Site',address:'900 Fictional Avenue',timezone:'America/Indiana/Indianapolis',windowStart:'09:00',windowEnd:'16:00'});
  const prospectContact=office('add_contact',{accountId:prospectId,name:'Demo Taylor Prospect',alias:'demo-prospect'});
  office('log_interaction',{accountId:prospectId,note:'Demo estimate requested; site walk-through scheduled.'});
  office('set_billing',{accountId:prospectId,locationId:prospectLocation,contactId:prospectContact});
  office('create_task',{accountId:prospectId,title:'Demo prospect qualification',assignee:supervisor,due:'2026-11-25'});
  const lost=office('create_account',{name:`Demo ${customerId} Lost Prospect`});
  office('lose_prospect',{accountId:lost,reason:'Demo budget deferred'});
  const archived=office('create_account',{name:`Demo ${customerId} Archived Prospect`});
  office('archive_account',{accountId:archived});
  const crmHeader='ExternalID,Name,Stage';
  office('import_accounts',{csv:`${crmHeader}\r\ndemo-${customerId}-crm,Demo Imported Prospect,prospect\r\ndemo-${customerId}-bad,Non-demo Rejected,customer\r\ndemo-${customerId}-crm,Demo Duplicate Row,prospect\r\n`});
  office('import_accounts',{csv:`${crmHeader}\r\ndemo-${customerId}-crm,Demo Imported Prospect,prospect\r\n`});
  office('import_accounts',{csv:`${crmHeader}\r\ndemo-${customerId}-crm,Demo Conflicting Name,customer\r\n`});
  const price={quantity:2,unitCents:2500,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0};
  const agreementId=office('create_agreement',{accountId,locationIds:locations,start:'2026-01-01',end:'2027-12-31',renewal:'2027-11-01',terms:'Demo only: 30-day cancellation notice.',...price});
  office('revise_agreement',{agreementId,quantity:3,unitCents:2400,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0});
  office('send_agreement',{agreementId});
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===agreementId).id,outcome:'success'});
  office('agreement_outcome',{agreementId,outcome:'signed'});
  const declinedAgreement=office('create_agreement',{accountId:prospectId,locationId:prospectLocation,start:'2026-11-01',end:'2027-10-31',renewal:'2027-09-01',terms:'Demo prospect terms; not accepted.',...price});
  office('send_agreement',{agreementId:declinedAgreement});
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===declinedAgreement).id,outcome:'success'});
  office('agreement_outcome',{agreementId:declinedAgreement,outcome:'declined'});
  const terminatedAgreement=office('create_agreement',{accountId,locationId:locations[0],start:'2026-01-01',end:'2027-12-31',renewal:'2027-11-01',terms:'Demo early termination example.',...price});
  office('send_agreement',{agreementId:terminatedAgreement});
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===terminatedAgreement).id,outcome:'success'});
  office('agreement_outcome',{agreementId:terminatedAgreement,outcome:'signed'});
  office('terminate_agreement',{agreementId:terminatedAgreement,reason:'Demo customer consolidation'});
  const recurring=office('create_estimate',{accountId,locationId:locations[0],agreementId,service:'recurring',mode:'onsite',unit:'container',...price});
  office('accept_estimate',{estimateId:recurring});
  const planId=office('create_plan',{estimateId:recurring,start:'2026-11-01',end:'2026-12-31',intervalDays:7});
  office('schedule_exception',{planId,date:'2026-11-08',action:'skip'});
  office('schedule_exception',{planId,date:'2026-11-22',action:'move',moveTo:'2026-11-23'});
  office('generate_jobs',{planId,from:'2026-11-01',through:'2026-11-29'});
  const cancelledOccurrence=commercial.jobs.find(j=>j.occurrence===`${planId}-2026-11-29`);
  office('cancel_job',{jobId:cancelledOccurrence.id});
  const cancelledPlanEstimate=office('create_estimate',{accountId,locationId:locations[0],service:'recurring',mode:'onsite',unit:'hour',quantity:2,unitCents:8000,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0});
  office('accept_estimate',{estimateId:cancelledPlanEstimate});
  const cancelledPlan=office('create_plan',{estimateId:cancelledPlanEstimate,start:'2026-11-01',end:'2026-12-31',intervalDays:14});
  office('cancel_plan',{planId:cancelledPlan});
  const purge=office('create_estimate',{accountId,locationId:locations[1],service:'purge',mode:'offsite',unit:'container',...price});
  office('accept_estimate',{estimateId:purge});
  office('schedule_purge',{estimateId:purge,date:SAMPLE_DAY});
  const ready=office('create_estimate',{accountId,locationId:locations[1],service:'purge',mode:'onsite',unit:'container',...price});
  office('accept_estimate',{estimateId:ready});
  office('schedule_purge',{estimateId:ready,date:SAMPLE_DAY});
  const weightDraft=office('create_estimate',{accountId,locationId:locations[1],service:'purge',mode:'onsite',unit:'weight',...price,quantity:50,measuredQuantity:'50.125',unitCents:40});
  office('revise_estimate',{estimateId:weightDraft,measuredQuantity:'51.250',unitCents:42,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0});
  const cancelledPurge=office('create_estimate',{accountId,locationId:locations[0],service:'purge',mode:'onsite',unit:'fixed',quantity:1,unitCents:1500,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0});
  office('accept_estimate',{estimateId:cancelledPurge});
  office('schedule_purge',{estimateId:cancelledPurge,date:'2026-11-02'});
  const draftPurge=office('create_estimate',{accountId,locationId:locations[0],service:'purge',mode:'offsite',unit:'container',...price});
  office('accept_estimate',{estimateId:draftPurge});
  office('schedule_purge',{estimateId:draftPurge,date:'2026-11-03'});
  const past=commercial.jobs.find(j=>j.date==='2026-11-01');
  office('complete_job',{jobId:past.id});
  const paidInvoice=office('draft_invoice',{accountId,jobIds:[past.id],from:'2026-11-01',to:'2026-11-01',due:'2026-11-10'});
  office('issue_invoice',{invoiceId:paidInvoice});
  const paymentId=office('request_payment',{invoiceId:paidInvoice,amountCents:past.price.totalCents});
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===paymentId).id,outcome:'success'});
  office('refund_payment',{paymentId,amountCents:500});
  const refund=commercial.payments.find(p=>p.id===paymentId).refunds[0];
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===refund.id).id,outcome:'success'});
  office('credit_invoice',{invoiceId:paidInvoice,amountCents:500,reason:'Demo service credit after partial refund'});
  const cancelledJob=commercial.jobs.find(j=>j.estimateId===cancelledPurge);
  office('complete_job',{jobId:cancelledJob.id});
  const cancelledInvoice=office('draft_invoice',{accountId,jobIds:[cancelledJob.id],from:'2026-11-02',to:'2026-11-02',due:'2026-11-12'});
  office('cancel_invoice',{invoiceId:cancelledInvoice});
  const draftJob=commercial.jobs.find(j=>j.estimateId===draftPurge);
  office('complete_job',{jobId:draftJob.id});
  const draftInvoice=office('draft_invoice',{accountId,jobIds:[draftJob.id],from:'2026-11-03',to:'2026-11-03',due:'2026-11-13'});
  // Only scheduled jobs enter field work; historical invoiced work stays in office.
  const imports=commercial.jobs.filter(j=>j.status==='scheduled').map(j=>{
    const l=commercial.locations.find(l=>l.id===j.locationId);
    return {...j,name:l.name,address:l.address,timezone:l.timezone,windowStart:l.windowStart,windowEnd:l.windowEnd,containers:2};
  });
  await drive('import_jobs',{jobs:imports});
  const vehicleId=await drive('add_vehicle',{name:`Demo ${customerId} Truck`,capacity:20,heightCm:350,widthCm:250,lengthCm:1000,weightKg:16000});
  const unavailable=await drive('add_vehicle',{name:`Demo ${customerId} Service Truck`,capacity:10,heightCm:350,widthCm:250,lengthCm:800,weightKg:12000});
  await drive('set_vehicle_availability',{vehicleId:unavailable,available:false});
  const driver=sampleDriver(customerId), today=field.jobs.filter(j=>j.date===SAMPLE_DAY);
  await drive('create_route',{vehicleId,driverId:driver,date:SAMPLE_DAY,jobIds:today.map(j=>j.id),startMinute:480,breakMinutes:30,dayLimit:480});
  const completed=today[0];
  await drive('start_job',{jobId:completed.id},driver);
  await drive('arrive_job',{jobId:completed.id},driver);
  for(let n=0;n<2;n++)await drive('scan_bin',{jobId:completed.id,barcode:`DEMO-BIN-${customerId.slice(1)}000${n}`},driver);
  await drive('complete_job',{jobId:completed.id,production:2,acknowledgment:'demo-customer'},driver);
  await drive('authorize_demo_destruction',{jobId:completed.id,reason:'Demo sample authorization — no real destruction'});
  await drive('perform_demo_destruction',{jobId:completed.id},driver);
  const certificateId=await drive('issue_certificate',{jobId:completed.id});
  await drive('set_delivery',{accountId,recipient:'demo-office',timezone:'America/Indiana/Indianapolis',consent:true});
  await drive('batch_certificates');
  const second=today[1];
  await drive('job_exception',{jobId:second.id,reason:'Demo site access unavailable'},driver);
  office('complete_job',{jobId:completed.commercialJobId});
  const unpaid=office('draft_invoice',{accountId,jobIds:[completed.commercialJobId],from:SAMPLE_DAY,to:SAMPLE_DAY,due:'2026-11-15'});
  office('issue_invoice',{invoiceId:unpaid});
  office('request_payment',{invoiceId:unpaid,amountCents:2500});
  const cancelPayment=office('request_payment',{invoiceId:unpaid,amountCents:1000});
  office('cancel_payment',{paymentId:cancelPayment});
  const retryable=commercial.outbox.find(o=>o.provider==='qbo'&&o.status==='pending');
  office('process_outbox',{outboxId:retryable.id,outcome:'failure'},at);
  office('process_outbox',{outboxId:retryable.id,outcome:'failure'},new Date(Date.parse(at)+61000).toISOString());
  office('process_outbox',{outboxId:retryable.id,outcome:'failure'},new Date(Date.parse(at)+181000).toISOString());
  office('review_delivery',{outboxId:retryable.id,reason:'Demo reviewed provider outage'},new Date(Date.parse(at)+181000).toISOString());
  office('process_outbox',{outboxId:retryable.id,outcome:'success'},new Date(Date.parse(at)+181000).toISOString());
  const invoiceDelivery=commercial.outbox.find(o=>o.provider==='qbo'&&o.kind==='invoice'&&o.status==='pending');
  if(invoiceDelivery){office('process_outbox',{outboxId:invoiceDelivery.id,outcome:'success'});office('reconcile_outbox',{outboxId:invoiceDelivery.id,externalId:commercial.outbox.find(o=>o.id===invoiceDelivery.id).externalId,amountCents:commercial.outbox.find(o=>o.id===invoiceDelivery.id).payload.totalCents});}
  const failure=commercial.outbox.find(o=>o.provider==='qbo'&&o.status==='pending');
  office('process_outbox',{outboxId:failure.id,outcome:'failure'});
  await drive('telemetry',{vehicleId,timestamp:at,latitude:39.7684,longitude:-86.1581,odometer:1000,diagnostic:'Demo normal'});
  await drive('request_export');
  for(let n=1;n<=16;n++)await store('register_record',{barcode:`DEMO-${n%2?'BX':'FL'}-${customerId.slice(1)}00${String(n).padStart(2,'0')}`,kind:n%2?'Box':'File'});
  const receiving=`demo-${customerId}-receiving`, codes=warehouse.records.filter(r=>r.status==='Expected').map(r=>r.barcode);
  await store('create_order',{orderId:receiving,operation:'Receiving',barcodes:codes});
  for(const barcode of codes){await store('receive',{orderId:receiving,barcode,location:'RECEIVING'});await store('stage',{orderId:receiving,barcode,location:'STAGE-01'});}
  for(const barcode of codes)await store('refile',{orderId:receiving,barcode,location:'A01-R01'});
  const outbound=`demo-${customerId}-retrieval`;
  await store('create_order',{orderId:outbound,operation:'Retrieval',barcodes:codes.slice(0,2)});
  for(const barcode of codes.slice(0,2)){await store('pick',{orderId:outbound,barcode});await store('stage',{orderId:outbound,barcode,location:'STAGE-01'});}
  await store('dispatch',{orderId:outbound,courier:'demo-courier'});
  await store('deliver',{orderId:outbound,recipient:'demo-recipient'});
  const returned=`demo-${customerId}-return-refile`;
  await store('create_order',{orderId:returned,operation:'Refile',barcodes:codes.slice(0,1)});
  for(const barcode of codes.slice(0,1)){await store('receive',{orderId:returned,barcode,location:'RECEIVING'});await store('stage',{orderId:returned,barcode,location:'STAGE-01'});await store('refile',{orderId:returned,barcode,location:'A02-R01'});}
  const withdrawals=`demo-${customerId}-file-withdrawal`;
  const files=warehouse.records.filter(record=>record.kind==='File'&&record.status==='Stored').map(record=>record.barcode).slice(0,2);
  await store('create_order',{orderId:withdrawals,operation:'Withdrawal',barcodes:files});
  for(const barcode of files){await store('pick',{orderId:withdrawals,barcode});await store('stage',{orderId:withdrawals,barcode,location:'STAGE-01'});}
  await store('dispatch',{orderId:withdrawals,courier:'demo-file-courier'});
  await store('deliver',{orderId:withdrawals,recipient:'demo-file-recipient'});
  const cancelledOrder=`demo-${customerId}-cancelled-order`;
  await store('create_order',{orderId:cancelledOrder,operation:'Retrieval',barcodes:[codes[2]]});
  await store('cancel_order',{orderId:cancelledOrder});
  await store('move',{barcode:codes[4],location:'A02-R01'});
  const manifest={datasetVersion:DATASET_VERSION,customerId,synthetic:true,referenceDate:SAMPLE_DAY,driverId:driver,driverActive:false,
    counts:{accounts:commercial.accounts.length,locations:commercial.locations.length,agreements:commercial.agreements.length,estimates:commercial.estimates.length,plans:commercial.plans.length,commercialJobs:commercial.jobs.length,invoices:commercial.invoices.length,payments:commercial.payments.length,outbox:commercial.outbox.length,fieldJobs:field.jobs.length,routes:field.routes.length,certificates:field.certificates.length,warehouseRecords:warehouse.records.length,warehouseOrders:warehouse.orders.length},
    references:{accountId,planId,certificateId,driverId:driver},
    scenarios:['prospect','customer','lost','archived','prospect-activity','prospect-qualification','multi-location','crm-import-accepted-matched-conflict-rejected','signed-agreement-revised','declined-agreement','terminated-agreement','draft-and-revised-estimates','measured-weight-pricing','recurrence-skip-and-move','cancelled-recurring-plan','scheduled-and-cancelled-jobs','draft-cancelled-issued-invoices','captured-refunded-credited-pending-cancelled-payments','provider-failure-review-retry-success','qbo-reconciliation-match','assigned-driver','completed-job','driver-exception','sample-certificate','delivery-draft','field-export-pending','warehouse-receiving-refile','box-retrieval-return-refile','file-withdrawal-courier','cancelled-work-order','location-movement','custody-verification','settlement-reconciliation','indexed-search','general-report-exports','document-archival']};
  const settlements=[['ExternalID','Kind','Reference','AmountCents','Currency']];let settlementNumber=0;
  for(const p of commercial.payments.filter(p=>p.status==='captured')){
    settlements.push(['demo-settlement-'+(++settlementNumber),'capture',p.id,p.amountCents,'USD']);
    for(const r of p.refunds.filter(r=>r.status==='refunded'))settlements.push(['demo-settlement-'+(++settlementNumber),'refund',r.id,r.amountCents,'USD']);
  }
  const matchedCsv=settlements.map(r=>r.join(',')).join('\r\n')+'\r\n',mismatched=settlements.map(r=>[...r]);mismatched[1][3]--;
  const fixtures={settlements:{matchedCsv,mismatchedCsv:mismatched.map(r=>r.join(',')).join('\r\n')+'\r\n'},reportKinds:['inventory','warehouse','custody','invoices','payments','field','field_custody']};
  fixtures.reportKinds=['inventory','warehouse','warehouse_orders','warehouse_receipts','custody','commercial_accounts','commercial_locations','commercial_contacts','commercial_interactions','commercial_followups','commercial_agreements','commercial_estimates','commercial_recurring_plans','commercial_jobs','invoices','payments','commercial_outbox','commercial_events','commercial_receipts','field','field_vehicles','field_routes','field_custody','field_certificates','field_delivery_settings','field_certificate_batches','field_telemetry','field_navigation','field_export_jobs','field_receipts'];
  return {manifest,commercial,field,warehouse,fixtures};
}
