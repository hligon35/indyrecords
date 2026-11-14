export async function nativeSignIn({baseUrl,redirectUri,randomHex,challengeFor,openSession,fetchImpl=fetch}){
 const base=new URL(baseUrl);
 if(base.protocol!=='https:'||base.origin!==baseUrl)throw Error('Approved HTTPS API origin required');
 if(!['irmrmsdemo://auth','irmrmsdesktop://auth'].includes(redirectUri))throw Error('Unapproved native redirect');
 const verifier=randomHex(),state=randomHex();
 if(!/^[a-f0-9]{64}$/.test(verifier)||!/^[a-f0-9]{64}$/.test(state))throw Error('Secure random bytes required');
 const challenge=await challengeFor(verifier);
 const result=await openSession(baseUrl+'/auth/login?'+new URLSearchParams({state,challenge,returnOrigin:redirectUri}),redirectUri);
 if(result?.type!=='success'||typeof result.url!=='string'||result.url.length>4096)throw Error('Sign-in was cancelled or did not return to the app');
 const incoming=new URL(result.url),expected=new URL(redirectUri),params=new URLSearchParams(incoming.hash.slice(1));
 if(incoming.protocol!==expected.protocol||incoming.host!==expected.host||incoming.pathname!==expected.pathname||incoming.username||incoming.password||incoming.search||params.get('state')!==state||!/^[a-f0-9]{64}$/.test(params.get('irm_login_code')||''))throw Error('Invalid native sign-in callback');
 const response=await fetchImpl(baseUrl+'/auth/exchange',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({state,verifier,code:params.get('irm_login_code')})});
 const session=await response.json();if(!response.ok||typeof session.accessToken!=='string'||!session.accessToken.startsWith('irm_session_')||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw Error(session.error||'Sign-in failed');
 return {baseUrl,...session};
}
