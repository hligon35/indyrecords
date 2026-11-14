export const DEMO_CUSTOMERS=Object.freeze([
 {id:'c1',name:'Demo Medical'},{id:'c2',name:'Sample Legal'},
 {id:'c3',name:'Example Finance'},{id:'c4',name:'Test Archives'}
]);
export function validateCustomerProfile(input){
 if(!input||!DEMO_CUSTOMERS.some(x=>x.id===input.customerId))throw Error('Synthetic customer required');
 if(typeof input.displayName!=='string'||input.displayName.trim().length<2||input.displayName.length>100||/[\u0000-\u001f\u007f]/.test(input.displayName))throw Error('Display name must be 2–100 characters');
 if(typeof input.contactAlias!=='string'||(input.contactAlias!==''&&!/^demo-[a-z0-9-]{1,60}$/i.test(input.contactAlias)))throw Error('Use a synthetic demo- contact alias');
 if(typeof input.active!=='boolean'||!Number.isInteger(input.expectedVersion)||input.expectedVersion<0)throw Error('Active state and current version are required');
 return {customerId:input.customerId,displayName:input.displayName.trim(),contactAlias:input.contactAlias,active:input.active,expectedVersion:input.expectedVersion};
}
export function defaultProfile(customer){return {customerId:customer.id,displayName:customer.name,contactAlias:'',active:true,version:0}}
