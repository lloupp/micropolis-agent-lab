/** User thresholds, frozen before benchmarking. Missing evidence blocks a claim.
 * Rates use all 100 decisions, not a success-only denominator.
 * @param {any} s @param {{rulesIsolated:boolean,testsGreen:boolean,checkGreen:boolean,ciGreen:boolean}} evidence */
export function evaluateSpatial(s,evidence){
  const measured=['spatialPlausibility','consecutiveRepeatRate','intentAgreement','agreementRate'].every(k=>typeof s[k]==='number');
  const mandatory={real:s.realInferences===100&&s.decisions===100,valid:s.valid>=99,invalid:s.invalid<=1,errors:s.errors===0,timeouts:s.timeouts<=1,
    isolation:evidence.rulesIsolated,tests:evidence.testsGreen,check:evidence.checkGreen,ci:evidence.ciGreen,
    mean:typeof s.latencyMs?.average==='number'&&s.latencyMs.average<=550,p95:typeof s.latencyMs?.p95==='number'&&s.latencyMs.p95<=650};
  const improvement={spatial:measured&&s.spatialPlausibility>=0.9,loops:s.possibleLoops<=35,exact:measured&&s.agreementRate>=0.1,
    intent:measured&&s.intentAgreement>=0.25,consecutive:measured&&s.consecutiveRepeatRate<=0.1,blocked:s.blockedByValidator<=5};
  const count=Object.values(improvement).filter(Boolean).length;
  let result='NEUTRO';
  // Missing CI/runtime evidence = blocked. Measured quality failure = regression.
  if(!measured||!mandatory.real||!mandatory.ci||!mandatory.tests||!mandatory.check)result='BLOQUEADO';
  else if(Object.values(mandatory).some(v=>!v)||s.possibleLoops>59||s.spatialPlausibility<0.8)result='REGRESSÃO';
  else if(count>=5&&s.spatialPlausibility>=0.95&&s.possibleLoops<=25&&s.intentAgreement>=0.35&&s.latencyMs.average<=403*1.2)result='MELHOROU MUITO';
  else if(count>=3&&(improvement.spatial||improvement.loops))result='MELHOROU';
  return {result,mandatory,improvement,improvementCount:count};
}
