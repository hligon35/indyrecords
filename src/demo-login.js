// Local demo sign-in gate. Client-side only: it is NOT real authentication and protects nothing.
// Real account sign-in (Cloudflare Access + PKCE) lives in login.js and the Remote page.
const SESSION_KEY='irm-rms-demo-session';
const DEMO_USER='demo',DEMO_PASSWORD='irm-demo';
export const isDemoSignedIn=(storage=sessionStorage)=>storage.getItem(SESSION_KEY)==='1';
export const demoSignOut=(storage=sessionStorage)=>storage.removeItem(SESSION_KEY);
export function demoSignIn(user,password,storage=sessionStorage){
 if(user.trim().toLowerCase()!==DEMO_USER||password!==DEMO_PASSWORD)return false;
 storage.setItem(SESSION_KEY,'1');return true;
}
// Shows the gate until the demo session exists; session ends when the window closes.
export function bindDemoGate({gate=document.getElementById('gate'),body=document.body,signOutButton=document.getElementById('signout')}={}){
 const sync=()=>{const ok=isDemoSignedIn();body.classList.toggle('locked',!ok);gate.hidden=ok;if(!ok)gate.querySelector('input')?.focus()};
 gate.querySelector('form').onsubmit=event=>{
  event.preventDefault();
  const form=event.target,error=gate.querySelector('[role=alert]');
  if(demoSignIn(form.user.value,form.password.value)){error.textContent='';form.reset();sync()}
  else error.textContent='Incorrect username or password.';
 };
 signOutButton.onclick=()=>{demoSignOut();sync()};
 sync();
}
