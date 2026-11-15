export async function entitySearch(env,customerId,params){
 const domain=params.get('domain')||'commercial',collection=params.get('collection')||'accounts',q=params.get('q')||'',cursor=params.get('cursor')||'',status=params.get('status')||'',from=params.get('from')||'',through=params.get('through')||'';
 const choices={commercial:['accounts','locations','contacts','activities','tasks','agreements','estimates','plans','jobs','invoices','payments','outbox'],warehouse:['records','orders','custody'],field:['jobs','vehicles','routes','custody','certificates','delivery','batches','telemetry','exports']};
 if(!choices[domain]?.includes(collection)||[q,cursor,status].some(s=>s.length>200||/[\u0000-\u001f]/.test(s)))throw Object.assign(Error('Invalid entity search'),{status:400});
 for(const d of [from,through])if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw Object.assign(Error('Invalid search date'),{status:400});
 if(from&&through&&from>through)throw Object.assign(Error('Invalid date range'),{status:400});
 const flag={commercial:'SYNTHETIC_COMMERCIAL_ENABLED',warehouse:'SYNTHETIC_WORKFLOWS_ENABLED',field:'SYNTHETIC_FIELD_ENABLED'}[domain];if(env[flag]!=='true')throw Object.assign(Error('Workspace disabled'),{status:403});
 const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%',rows=(await env.DB.prepare("SELECT entity_id,payload,source_version,status,service_date FROM operational_entities WHERE customer_id=? AND domain=? AND collection=? AND entity_id>? AND (?='' OR payload LIKE ? ESCAPE '\\') AND (?='' OR status=?) AND (?='' OR service_date>=?) AND (?='' OR service_date<=?) ORDER BY entity_id LIMIT 101").bind(customerId,domain,collection,cursor,q,pattern,status,status,from,from,through,through).all()).results||[];
 return {domain,collection,items:rows.slice(0,100).map(r=>({...r,payload:JSON.parse(r.payload)})),nextCursor:rows.length>100?rows[99].entity_id:null};
}
