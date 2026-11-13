// Standalone demo API. Do not deploy publicly with mutation access.
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const fail=(message,status)=>json({error:message},status);
const allowedOperations=new Set(['Box Retrieval','Box Withdrawal','Box Destruction','File Retrieval','File Withdrawal','File Destruction','Box Refile','Staged Files','File Refile']);
const MAX_SEARCH=100;
function requireAuth(request,env){
  // A single secret is intentionally a DEVELOPMENT ONLY safeguard.
  // Replace with authenticated user sessions and scoped RBAC before a pilot.
  if(!env.DEMO_API_TOKEN)return false;
  const token=request.headers.get('authorization');
  return token===('Bearer '+env.DEMO_API_TOKEN);
}
async function handler(request,env){
  if(!env.DB)return fail('Database binding unavailable',503);
  const url=new URL(request.url);
  const path=url.pathname;
  if(path==='/health'&&request.method==='GET')return json({status:'ok',service:'irm-rms-demo-api'});
  if(!requireAuth(request,env))return fail('Unauthorized demo API request',401);
  if(path==='/v1/records'&&request.method==='GET'){
    const q=(url.searchParams.get('q')||'').trim().slice(0,100);
    const limit=Math.min(MAX_SEARCH,Math.max(1,Number(url.searchParams.get('limit'))||25));
    const cursor=(url.searchParams.get('cursor')||'').slice(0,100);
    const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
    const result=await env.DB.prepare(`SELECT r.id,r.barcode,r.kind,r.status,c.name AS customer,l.label AS location
      FROM records r JOIN customers c ON c.id=r.customer_id LEFT JOIN locations l ON l.id=r.location_id
      WHERE r.id > ? AND (r.barcode LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR l.label LIKE ? ESCAPE '\\')
      ORDER BY r.id LIMIT ?`).bind(cursor,pattern,pattern,pattern,limit+1).all();
    const rows=result.results||[];
    return json({items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null});
  }
  if(path.startsWith('/v1/records/')&&request.method==='GET'){
    const barcode=decodeURIComponent(path.slice('/v1/records/'.length));
    if(barcode.length>100)return fail('Invalid barcode',400);
    const row=await env.DB.prepare(`SELECT r.id,r.barcode,r.kind,r.status,c.name AS customer,l.label AS location
      FROM records r JOIN customers c ON c.id=r.customer_id LEFT JOIN locations l ON l.id=r.location_id WHERE r.barcode=?`).bind(barcode).first();
    return row?json(row):fail('Record not found',404);
  }
  if(path==='/v1/scans'&&request.method==='POST'){
    let body;try{body=await request.json()}catch{return fail('Invalid JSON',400)}
    const {clientEventId,barcode,operation,mode,occurredAt,workOrderId}=body||{};
    if(![clientEventId,barcode,operation,mode,occurredAt].every(x=>typeof x==='string'&&x.length>0&&x.length<=120))return fail('Missing or invalid scan fields',400);
    if(!allowedOperations.has(operation)||!['inbound','outbound'].includes(mode)||!Number.isFinite(Date.parse(occurredAt)))return fail('Invalid operation or timestamp',400);
    // Destruction is deliberately blocked until approved authorization and custody workflow exists.
    if(operation.includes('Destruction'))return fail('Destruction requires a separately approved workflow',403);
    const existing=await env.DB.prepare('SELECT id FROM scan_events WHERE client_event_id=?').bind(clientEventId).first();
    if(existing)return json({status:'already_accepted',id:existing.id});
    const record=await env.DB.prepare('SELECT id,kind FROM records WHERE barcode=?').bind(barcode).first();
    if(!record)return fail('Barcode not found',404);
    if((operation.startsWith('Box')&&record.kind!=='Box')||(operation.startsWith('File')&&record.kind!=='File'))return fail('Record type mismatch',409);
    // No work order validation exists yet; reject order-linked mutations rather than pretend to verify them.
    if(workOrderId)return fail('Work-order validation not yet implemented',501);
    const id=crypto.randomUUID();
    try{
      await env.DB.prepare('INSERT INTO scan_events(id,client_event_id,record_id,operation,mode,actor_id,occurred_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id,clientEventId,record.id,operation,mode,'demo-api-user',occurredAt).run();
    }catch(error){
      const duplicate=await env.DB.prepare('SELECT id FROM scan_events WHERE client_event_id=?').bind(clientEventId).first();
      if(duplicate)return json({status:'already_accepted',id:duplicate.id});
      throw error;
    }
    return json({status:'accepted',id},201);
  }
  if(path==='/v1/reports/summary'&&request.method==='GET'){
    const [inventory,scans]=await Promise.all([
      env.DB.prepare('SELECT kind,status,COUNT(*) AS total FROM records GROUP BY kind,status').all(),
      env.DB.prepare('SELECT operation,COUNT(*) AS total FROM scan_events GROUP BY operation').all()
    ]);
    return json({inventory:inventory.results||[],scans:scans.results||[]});
  }
  return fail('Not found',404);
}
export default {async fetch(request,env){try{return await handler(request,env)}catch(error){console.error('IRM demo API error',error);return fail('Internal error',500)}}};
export {handler};
