import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {decide} from '../overlay/agent/julia-client.js';
import {createJuliaMemory,advanceJuliaMemory,createShadowRecord,validateJuliaDecision,summarizeShadow} from '../overlay/agent/agents.js';
import {evaluateSpatial} from '../overlay/agent/evaluation.js';

// Historical replay has no engine or executor. It cannot certify live isolation.
const file='docs/evidence/spatial-v1/requests.jsonl';
const source=await readFile(file,'utf8');
const requests=source.trim().split('\n').map(line=>JSON.parse(line));
assert.equal(requests.length,100);
const endpoints={v1:process.env.JULIA_V1_URL??'http://127.0.0.1:8765/decide',v2:process.env.JULIA_V2_URL??'http://127.0.0.1:8766/decide'};
const experiment=process.env.JULIA_EXPERIMENT??'semantics-v2';
assert.ok(['semantics-v2','semantics-v3'].includes(experiment));
const encoding={v1:'distances-v1',v2:experiment};
for(const arm of ['v1','v2']){
 const health=await fetch(new URL('/health',endpoints[arm]));
 assert.ok(health.ok);assert.equal((await health.json()).spatialEncoding,encoding[arm]);
}
const rows={v1:[],v2:[]},memory={v1:createJuliaMemory(),v2:createJuliaMemory()};
const dir=`artifacts/julia-spatial-${experiment==='semantics-v2'?'v2':'v3'}`;await mkdir(dir,{recursive:true});
for(const captured of requests){
 for(const arm of captured.decision%2?['v1','v2']:['v2','v1']){
  const reply=await decide(structuredClone(captured.snapshot),captured.candidates,memory[arm],{endpoint:endpoints[arm]});
  const validation=reply.status==='response'&&reply.provenance?.spatialEncoding===encoding[arm]
   ?validateJuliaDecision(reply.output,captured.candidates)
   :{status:reply.status==='response'?'invalid':reply.status,reason:reply.reason??'encoding_mismatch',candidate:null};
  const row=createShadowRecord({...captured,validation,rawDecision:reply.output,latencyMs:reply.latencyMs,previousRecords:rows[arm],source:'real',provenance:reply.provenance,endpoint:reply.endpoint});
  rows[arm].push(row);memory[arm]=advanceJuliaMemory(memory[arm],row.juliaActionId);
 }
 // Keep completed inference evidence even if the process is interrupted.
 for(const arm of ['v1','v2'])await writeFile(`${dir}/${arm}.jsonl`,rows[arm].map(row=>JSON.stringify(row)).join('\n')+'\n');
}
const summaries={v1:summarizeShadow(rows.v1),v2:summarizeShadow(rows.v2)};
const ids=new Set([...rows.v1,...rows.v2].filter(row=>row.provenance).map(row=>`${row.provenance.instanceId}:${row.provenance.requestId}`));
const report={experiment,source:file,sourceSha256:createHash('sha256').update(source).digest('hex'),classifier:'physical-prerequisites-v1',comparison:'Same 100 historical states and candidates; independent memory; alternating AB/BA; v1 versus v2 description encoding.',uniqueInferenceIds:ids.size,summaries,evaluation:evaluateSpatial(summaries.v2,{rulesIsolated:false,testsGreen:false,checkGreen:false,ciGreen:false}),limitation:'Historical replay cannot certify live Rules isolation or CI; full gate remains blocked.'};
await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
assert.equal(ids.size,200);assert.equal(summaries.v1.realInferences,100);assert.equal(summaries.v2.realInferences,100);
