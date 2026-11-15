import {seedCommercial, applyCommercial} from '../commercial/workflows.js';
import {seedField, applyField} from '../field/workflows.js';
import {seedWarehouse, applyWarehouseCommand} from '../warehouse/workflows.js';

export const DATASET_VERSION = 'irm-full-sample-v1';
export const SAMPLE_DAY = '2026-11-15';
export const sampleDriver = tenant => `demo-user-sample-${tenant}-driver`;
const at = '2026-11-15T15:00:00.000Z';
const supervisor = 'demo-sample-supervisor';
export async function buildSampleDataset(customerId) {
  if (!['c1','c2','c3','c4'].includes(customerId)) throw Error('Synthetic tenant required');
  let commercial = seedCommercial(customerId), field = seedField(customerId), warehouse = seedWarehouse(customerId);
  let sequence = 0;
  const id = label => `demo-${customerId}-${label}-${++sequence}`;
  function office(type, input = {}) {
    const key = id(type.replaceAll('_','-'));
    commercial = applyCommercial(commercial, {id:key,type,input,expectedVersion:commercial.version}, supervisor, at).state;
    return key;
  }
  async function drive(type,input={},actor=supervisor) {
    const key=id(type.replaceAll('_','-')), job=field.jobs.find(j=>j.id===input.jobId);
    field=(await applyField(field,{clientEventId:key,type,input,expectedVersion:field.version,expectedJobVersion:job?.version},actor,at)).state;
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
  office('create_account',{name:`Demo ${customerId} Prospect`});
  const lost=office('create_account',{name:`Demo ${customerId} Lost Prospect`});
  office('lose_prospect',{accountId:lost,reason:'Demo budget deferred'});
  const archived=office('create_account',{name:`Demo ${customerId} Archived Prospect`});
  office('archive_account',{accountId:archived});
  const price={quantity:2,unitCents:2500,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0};
  const agreementId=office('create_agreement',{accountId,locationIds:locations,start:'2026-01-01',end:'2027-12-31',renewal:'2027-11-01',terms:'Demo only: 30-day cancellation notice.',...price});
  office('send_agreement',{agreementId});
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===agreementId).id,outcome:'success'});
  office('agreement_outcome',{agreementId,outcome:'signed'});
  const recurring=office('create_estimate',{accountId,locationId:locations[0],agreementId,service:'recurring',mode:'onsite',unit:'container',...price});
  office('accept_estimate',{estimateId:recurring});
  const planId=office('create_plan',{estimateId:recurring,start:'2026-11-01',end:'2026-12-31',intervalDays:7});
  office('schedule_exception',{planId,date:'2026-11-08',action:'skip'});
  office('generate_jobs',{planId,from:'2026-11-01',through:'2026-11-29'});
  const purge=office('create_estimate',{accountId,locationId:locations[1],service:'purge',mode:'offsite',unit:'container',...price});
  office('accept_estimate',{estimateId:purge});
  office('schedule_purge',{estimateId:purge,date:SAMPLE_DAY});
  const ready=office('create_estimate',{accountId,locationId:locations[1],service:'purge',mode:'onsite',unit:'container',...price});
  office('accept_estimate',{estimateId:ready});
  office('schedule_purge',{estimateId:ready,date:SAMPLE_DAY});
  office('create_estimate',{accountId,locationId:locations[1],service:'purge',mode:'onsite',unit:'weight',...price,quantity:50,measuredQuantity:'50.125',unitCents:40});
  const past=commercial.jobs.find(j=>j.date==='2026-11-01');
  office('complete_job',{jobId:past.id});
  const paidInvoice=office('draft_invoice',{accountId,jobIds:[past.id],from:'2026-11-01',to:'2026-11-01',due:'2026-11-10'});
  office('issue_invoice',{invoiceId:paidInvoice});
  const paymentId=office('request_payment',{invoiceId:paidInvoice,amountCents:5000});
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===paymentId).id,outcome:'success'});
  office('refund_payment',{paymentId,amountCents:500});
  const refund=commercial.payments.find(p=>p.id===paymentId).refunds[0];
  office('process_outbox',{outboxId:commercial.outbox.find(o=>o.entityId===refund.id).id,outcome:'success'});
  office('credit_invoice',{invoiceId:paidInvoice,amountCents:500,reason:'Demo service credit after partial refund'});
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
  const failure=commercial.outbox.find(o=>o.provider==='qbo'&&o.status==='pending');
  office('process_outbox',{outboxId:failure.id,outcome:'failure'});
  await drive('telemetry',{vehicleId,timestamp:at,latitude:39.7684,longitude:-86.1581,odometer:1000,diagnostic:'Demo normal'});
  await drive('request_export');
  for(let n=1;n<=8;n++)await store('register_record',{barcode:`DEMO-${n%2?'BX':'FL'}-${customerId.slice(1)}00${n}`,kind:n%2?'Box':'File'});
  const receiving=`demo-${customerId}-receiving`, codes=warehouse.records.filter(r=>r.status==='Expected').map(r=>r.barcode);
  await store('create_order',{orderId:receiving,operation:'Receiving',barcodes:codes});
  for(const barcode of codes){await store('receive',{orderId:receiving,barcode,location:'RECEIVING'});await store('stage',{orderId:receiving,barcode,location:'STAGE-01'});}
  for(const barcode of codes)await store('refile',{orderId:receiving,barcode,location:'A01-R01'});
  const outbound=`demo-${customerId}-retrieval`;
  await store('create_order',{orderId:outbound,operation:'Retrieval',barcodes:codes.slice(0,2)});
  for(const barcode of codes.slice(0,2)){await store('pick',{orderId:outbound,barcode});await store('stage',{orderId:outbound,barcode,location:'STAGE-01'});}
  await store('dispatch',{orderId:outbound,courier:'demo-courier'});
  await store('deliver',{orderId:outbound,recipient:'demo-recipient'});
  const manifest={datasetVersion:DATASET_VERSION,customerId,synthetic:true,referenceDate:SAMPLE_DAY,driverId:driver,driverActive:false,
    counts:{accounts:commercial.accounts.length,locations:commercial.locations.length,agreements:commercial.agreements.length,estimates:commercial.estimates.length,plans:commercial.plans.length,commercialJobs:commercial.jobs.length,invoices:commercial.invoices.length,payments:commercial.payments.length,outbox:commercial.outbox.length,fieldJobs:field.jobs.length,routes:field.routes.length,certificates:field.certificates.length,warehouseRecords:warehouse.records.length,warehouseOrders:warehouse.orders.length},
    references:{accountId,planId,certificateId,driverId:driver},
    scenarios:['prospect','customer','lost','archived','multi-location','signed-agreement','recurrence-skip','paid-refund-credit','unpaid-checkout','provider-retry','assigned-driver','completed-job','driver-exception','sample-certificate','delivery-draft','warehouse-receiving','retrieval-courier','export-pending']};
  return {manifest,commercial,field,warehouse};
}
