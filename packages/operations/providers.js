// Capability registry: never infer a live connection from a fixture adapter.
export const PROVIDERS = Object.freeze([
  {id:'docusign',capabilities:['agreement-delivery'],mode:'synthetic',live:false},
  {id:'payments',capabilities:['capture','refund'],mode:'synthetic',live:false},
  {id:'qbo',capabilities:['customer','invoice','payment','credit','refund'],mode:'synthetic',live:false},
  {id:'certificate-mail',capabilities:['certificate-delivery'],mode:'synthetic',live:false},
  {id:'andrew',capabilities:['read-only-export'],mode:'synthetic-export',live:false},
  {id:'q-shred',capabilities:['read-only-export'],mode:'synthetic-export',live:false},
  {id:'truck-navigation',capabilities:['route-fixture'],mode:'simulation',live:false},
  {id:'fleet',capabilities:['telemetry-fixture'],mode:'simulation',live:false,cameraStreaming:false,approvedELD:false}
]);
export function validateTaskInput(x) {
  if(!x || !['commercial_delivery','certificate_delivery','recurrence','field_export'].includes(x.kind))throw Object.assign(Error('Choose a supported task kind'),{status:400});
  if(typeof x.sourceId!=='string'||x.sourceId.length>200||!/^[A-Za-z0-9:_-]+$/.test(x.sourceId))throw Object.assign(Error('Invalid source reference'),{status:400});
  if(typeof x.requestKey!=='string'||!/^demo-[A-Za-z0-9-]{1,80}$/.test(x.requestKey))throw Object.assign(Error('Synthetic request key required'),{status:400});
  const outcomes=x.outcomes??['success'];
  if(!Array.isArray(outcomes)||outcomes.length<1||outcomes.length>3||outcomes.some(v=>!['success','transient','permanent'].includes(v)))throw Object.assign(Error('Use one to three synthetic outcomes'),{status:400});
  if(['recurrence','field_export'].includes(x.kind)&&JSON.stringify(outcomes)!=='["success"]')throw Object.assign(Error('Only deliveries support failure fixtures'),{status:400});
  let options={};
  if(x.kind==='recurrence'){
    const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    if(!valid(x.from)||!valid(x.through)||x.from>x.through||(Date.parse(x.through)-Date.parse(x.from))/86400000>90)throw Object.assign(Error('Recurrence requires a valid date range up to 90 days'),{status:400});
    options={from:x.from,through:x.through};
  }
  return {kind:x.kind,sourceId:x.sourceId,requestKey:x.requestKey,policy:{outcomes,options}};
}
