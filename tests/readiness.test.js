import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePilot} from '../packages/readiness/pilot.js';
test('missing platform, security and external evidence cannot silently pass readiness',()=>{
 const result=evaluatePilot();assert.equal(result.demoReady,false);assert.equal(result.productionReady,false);assert.ok(result.blockers.some(x=>x.includes('Dependency')));assert.ok(result.blockers.some(x=>x.includes('zebraDevice')));
});
test('even reported approvals cannot authorize production writes or certify a supervised pilot',()=>{
 const checks=Object.fromEntries(['workingTree','tests','webBuild','workerPackage','localD1','androidBundle','androidInstaller','zebraModule','windowsInstaller'].map(x=>[x,{passed:true,reference:'local-test-log'}]));
 const evidence=Object.fromEntries(['identityProvider','vendorContracts','zebraDevice','windowsRuntime','signing','restoreDrill','managementApproval'].map(x=>[x,{status:'approved',reviewer:'Synthetic reviewer',reference:'demo-reference'}]));
 const result=evaluatePilot({checks,evidence,advisories:{high:0,critical:0}});assert.equal(result.demoReady,true);assert.equal(result.supervisedPilotReady,false);assert.equal(result.productionReady,false);assert.equal(result.policy.vendorWriteback,false);assert.equal(result.externalEvidenceRequiresHumanReview,true);
});
