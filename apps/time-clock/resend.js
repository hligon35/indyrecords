// Transactional email adapter. Never expose the Resend secret to browsers.
export const FROM_ADDRESS='IRM Time Clock <clock@alphazonelabs.com>';
export const REQUESTED_DOMAIN='mail.alphazonelabs.com';
export async function sendTransactional(env,{to,subject,text}){
 if(env.EMAIL_ENABLED!=='true')return {status:'DISABLED'};
 if(!env.RESEND_API_KEY)throw Error('RESEND_NOT_CONFIGURED');
 if(env.RESEND_VERIFIED_FROM_DOMAIN!=='alphazonelabs.com')throw Error('RESEND_FROM_DOMAIN_UNVERIFIED');
 if(typeof to!=='string'||!/^\S+@\S+\.\S+$/.test(to)||to.length>254)throw Error('INVALID_EMAIL');
 if(typeof subject!=='string'||!subject||subject.length>140||typeof text!=='string'||!text||text.length>3000)throw Error('INVALID_MESSAGE');
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:FROM_ADDRESS,to:[to],subject,text})});
 if(!res.ok)throw Error('RESEND_DELIVERY_FAILED');
 const data=await res.json();
 if(typeof data.id!=='string'||!data.id)throw Error('RESEND_MISSING_MESSAGE_ID');
 return {status:'SENT',id:data.id};
}
