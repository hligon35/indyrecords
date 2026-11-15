import {digest} from './auth.js';
export async function authRateLimit(request,env){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/auth/')&&!(path==='/v1/session'&&request.method==='POST'))return null;
 const now=Math.floor(Date.now()/1000),minute=Math.floor(now/60)*60;
 const peer=request.headers.get('cf-connecting-ip')||'unidentified';
 const bucket=path+':'+await digest(peer)+':'+minute;
 await env.DB.prepare('DELETE FROM auth_rate_limits WHERE window_start<?').bind(now-3600).run();
 const row=await env.DB.prepare('INSERT INTO auth_rate_limits(bucket,window_start,attempts) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,minute).first();
 if(!row)throw Error('Authentication rate storage unavailable');
 if(row.attempts<=10)return null;
 return new Response(JSON.stringify({error:'Too many sign-in attempts; try again shortly'}),{status:429,headers:{'content-type':'application/json','cache-control':'no-store','retry-after':String(60-(now-minute))}});
}
export async function purgeExpiredSecurityData(DB,now=Date.now()){
 // Explicit maintenance operation, used only against the selected local synthetic database.
 const [sessions,logins,rates]=await Promise.all([
  DB.prepare('DELETE FROM app_sessions WHERE expires_at<? OR revoked_at IS NOT NULL').bind(now-86400000).run(),
  DB.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(now-86400000).run(),
  DB.prepare('DELETE FROM auth_rate_limits WHERE window_start<?').bind(Math.floor(now/1000)-3600).run()
 ]);
 return {sessions:sessions.meta?.changes||0,logins:logins.meta?.changes||0,rateBuckets:rates.meta?.changes||0};
}
