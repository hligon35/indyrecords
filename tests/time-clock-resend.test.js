import test from 'node:test';
import assert from 'node:assert/strict';
import {sendTransactional,FROM_ADDRESS,REQUESTED_DOMAIN} from '../apps/time-clock/resend.js';
test('sending stays disabled without explicitly enabled email',async()=>{
 assert.deepEqual(await sendTransactional({}, {to:'test@example.com',subject:'Test',text:'hello'}),{status:'DISABLED'});
});
test('configured sender is recorded, not automatically verified',()=>{
 assert.equal(FROM_ADDRESS,'IRM Time Clock <clock@alphazonelabs.com>');
 assert.equal(REQUESTED_DOMAIN,'mail.alphazonelabs.com');
});
test('a sending domain mismatch or missing Resend secret fails closed',async()=>{
 await assert.rejects(()=>sendTransactional({EMAIL_ENABLED:'true'}, {to:'test@example.com',subject:'Test',text:'hello'}),/RESEND_NOT_CONFIGURED/);
 await assert.rejects(()=>sendTransactional({EMAIL_ENABLED:'true',RESEND_API_KEY:'test',RESEND_VERIFIED_FROM_DOMAIN:'mail.alphazonelabs.com'}, {to:'test@example.com',subject:'Test',text:'hello'}),/RESEND_FROM_DOMAIN_UNVERIFIED/);
});
