import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHarness} from './wasm-harness.mjs';
import {smokeJulia} from './smoke-julia-real.mjs';
import {decide,isRealJuliaProvenance} from '../overlay/agent/julia-client.js';
import {availableActionsFor} from '../overlay/agent/candidates.js';
import {candidateFeatures} from '../overlay/agent/spatial.js';
import {actionId,createJuliaMemory,advanceJuliaMemory,createShadowRecord,validateJuliaDecision,summarizeShadow} from '../overlay/agent/agents.js';
import {decideRules,advanceMemory,makeInitialMemory} from '../overlay/agent/rules.js';
import {evaluateSpatial} from '../overlay/agent/evaluation.js';
const endpoint=process.env.JULIA_SHADOW_URL;
const smoke=await smokeJulia(endpoint);
const {simulator,runtime}=await createHarness();const m=simulator.micropolis;
const rows={baseline:[],spatial:[]},memories={baseline:createJuliaMemory(),spatial:createJuliaMemory()};
let queue=Promise.resolve(),rulesMemory=makeInitialMemory(),history=[],failures=[],lastResult=null;
const requests=[],checkpoints=[];
function hashMap(){const values=new Uint16Array(120*100);for(let y=0;y<100;y++)for(let x=0;x<120;x++)values[y*120+x]=m.getTile(x,y);return createHash('sha256').update(Buffer.from(values.buffer)).digest('hex');}
function enqueue(data){const captured=structuredClone(data);requests.push(captured);
 queue=queue.then(async()=>{
  // Alternate AB/BA to avoid warming/order systematically favoring one arm.
  for(const arm of captured.decision%2?['baseline','spatial']:['spatial','baseline']){
   const snapshot=structuredClone(captured.snapshot);if(arm==='baseline')delete snapshot.candidateFeatures;
   let reply;try{reply=captured.preparationError?{status:'invalid',reason:captured.preparationError,latencyMs:0}:await decide(snapshot,captured.candidates,memories[arm],{endpoint});}catch{reply={status:'error',reason:'client_exception',latencyMs:0};}
   const validation=reply.status==='response'&&isRealJuliaProvenance(reply.provenance)?validateJuliaDecision(reply.output,captured.candidates):{status:reply.status==='response'?'invalid':reply.status,reason:reply.reason??'unverified_model',candidate:null};
   const row=createShadowRecord({...captured,validation,rawDecision:reply.output,latencyMs:reply.latencyMs,previousRecords:rows[arm],source:'real',provenance:reply.provenance,endpoint:reply.endpoint});
   rows[arm].push(row);memories[arm]=advanceJuliaMemory(memories[arm],row.juliaActionId);
  }
 });
}
try{
 m.loadCity('/cities/haight.cty');runtime.resetLaboratory(simulator);simulator.setFramesPerSecond(0);
 const initial=runtime.readSnapshot(simulator);assert.equal(initial.cityPop,0);assert.equal(initial.totalFunds,20000);assert.ok(simulator.mapData.every(t=>t===0));checkpoints.push({decision:0,...initial});
 for(let decision=1;decision<=100;decision++){
  const snapshot=runtime.readSnapshot(simulator),action=decideRules(snapshot,rulesMemory);
  let candidates=[],features=[],preparationError=null;
  try{candidates=availableActionsFor(snapshot,action,a=>runtime.isLegalBuildCandidate(simulator,a));features=candidateFeatures((x,y)=>m.getTile(x,y),120,100,candidates,snapshot.totalFunds);}catch{preparationError='candidate_preparation_error';}
  const modelSnapshot={...snapshot,candidateFeatures:features,lastActions:history,lastActionResult:lastResult,recentFailures:failures};
  const result=runtime.executeAction(simulator,action);
  enqueue({decision,snapshot:modelSnapshot,candidates,rulesDecision:{actionId:actionId(action)},rulesResult:result,preparationError});
  if(!result.ok)failures=[result.message,...failures].slice(0,5);
  history=[{actionId:actionId(action),result:result.message},...history].slice(0,8);lastResult=result.message;rulesMemory=advanceMemory(rulesMemory,action);
  const time=m.cityTime;for(let tick=0;tick<39;tick++)simulator.tick();assert.ok(m.cityTime>time);
  if(decision%25===0)checkpoints.push({decision,...runtime.readSnapshot(simulator)});
  await new Promise(resolve=>setImmediate(resolve));
 }
 const final=runtime.readSnapshot(simulator),before=hashMap();
 assert.equal(final.cityPop,3360);assert.equal(final.totalFunds,15358);assert.equal(final.cityTime,244);assert.equal(failures.length,0);
 const rulesCompletedBeforeInference=rows.spatial.length<100;
 await queue;
 const rulesIsolated=hashMap()===before&&JSON.stringify(runtime.readSnapshot(simulator))===JSON.stringify(final);
 const uniqueIds=new Set([...rows.baseline,...rows.spatial].filter(r=>r.provenance).map(r=>`${r.provenance.instanceId}:${r.provenance.requestId}`));
 const summaries={baseline:summarizeShadow(rows.baseline),spatial:summarizeShadow(rows.spatial)};
 const report={seed:42,smokeProvenance:smoke.provenance,classifier:'physical-prerequisites-v1',initial,final,checkpoints,rulesIsolated,rulesCompletedBeforeInference,uniqueInferenceIds:uniqueIds.size,
  comparison:'Same historical state/candidates; independent short memory; AB/BA alternating; only difference is spatial observations.',summaries,
  evaluation:evaluateSpatial(summaries.spatial,{rulesIsolated,testsGreen:false,checkGreen:false,ciGreen:false})};
 const dir='artifacts/julia-spatial';await mkdir(dir,{recursive:true});
 for(const arm of ['baseline','spatial'])await writeFile(`${dir}/${arm}.jsonl`,rows[arm].map(r=>JSON.stringify(r)).join('\n')+'\n');
 await writeFile(`${dir}/requests.jsonl`,requests.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 assert.ok(rulesIsolated);assert.equal(uniqueIds.size,200);assert.equal(summaries.spatial.realInferences,100);assert.equal(summaries.baseline.realInferences,100);
}finally{simulator.dispose();}
