/** Authorization policy primitives. Authentication must supply a verified principal. */
export const ROLES=Object.freeze(['viewer','warehouse','dispatcher','manager','admin']);
const grants=Object.freeze({
 viewer:['records:read','reports:read'],
 warehouse:['records:read','reports:read','scans:create'],
 dispatcher:['records:read','reports:read','orders:read','orders:manage'],
 manager:['records:read','reports:read','orders:read','orders:manage','scans:create','audit:read'],
 admin:['records:read','reports:read','orders:read','orders:manage','scans:create','audit:read','users:manage']
});
export function can(principal,permission,{customerId}={}){
 if(!principal||principal.active!==true||typeof principal.id!=='string'||!principal.id.trim())return false;
 if(!ROLES.includes(principal.role)||!grants[principal.role].includes(permission))return false;
 if(customerId!==undefined){
   if(typeof customerId!=='string'||!customerId)return false;
   if(!Array.isArray(principal.customerIds)||!principal.customerIds.includes(customerId))return false;
 }
 return true;
}
export function assertPermission(principal,permission,scope){if(!can(principal,permission,scope)){const error=new Error('Forbidden');error.status=403;throw error}}
export function redactPrincipal(principal){return principal?{id:principal.id,role:principal.role,active:principal.active===true}:null}
