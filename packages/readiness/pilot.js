export function evaluatePilot({checks={},advisories={high:null,critical:null},evidence={},commit='unknown'}={}){
 const requiredChecks=['workingTree','tests','webBuild','workerPackage','localD1','androidBundle','androidInstaller','zebraModule','windowsInstaller'];
 const requiredEvidence=['identityProvider','vendorContracts','zebraDevice','windowsRuntime','signing','restoreDrill','managementApproval'];
 const software=requiredChecks.map(name=>({name,passed:checks[name]?.passed===true,reference:checks[name]?.reference||null}));
 const approvals=requiredEvidence.map(name=>({name,status:evidence[name]?.status==='approved'?'reported-approved':'pending',reviewer:evidence[name]?.reviewer||null,reference:evidence[name]?.reference||null}));
 const blockers=software.filter(x=>!x.passed).map(x=>'Software check missing or failed: '+x.name);
 if(!Number.isInteger(advisories.high)||!Number.isInteger(advisories.critical))blockers.push('Dependency audit evidence is missing');
 else if(advisories.high||advisories.critical)blockers.push('High/critical dependency advisories remain');
 for(const item of approvals)if(item.status!=='reported-approved'||!item.reviewer||!item.reference)blockers.push('External acceptance evidence missing: '+item.name);
 // Repository tests cannot certify external approvals. Production remains disabled under current policy.
 if((advisories.moderate||0)+(advisories.low||0)>0)blockers.push('Low/moderate dependency findings require documented risk review or remediation');
 return {schemaVersion:1,commit,generatedAt:new Date().toISOString(),demoReady:software.every(x=>x.passed),securityHighCriticalClear:advisories.high===0&&advisories.critical===0,productionReady:false,supervisedPilotReady:false,software,advisories,approvals,blockers:[...blockers,'Live records, vendor connections and operational production mutations remain prohibited'],policy:{syntheticOnly:true,vendorWriteback:false,productionMutations:false,publicSharedToken:false},externalEvidenceRequiresHumanReview:true};
}
