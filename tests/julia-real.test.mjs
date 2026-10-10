import test from 'node:test';
import assert from 'node:assert/strict';
import model from '../overlay/agent/julia-model.json' with { type: 'json' };
import { decide } from '../overlay/agent/julia-client.js';
import { createShadowObserver } from '../overlay/agent/shadow-observer.js';
import { summarizeShadow, validateJuliaDecision } from '../overlay/agent/agents.js';
const candidates=[{id:'wait',action:{kind:'wait',reason:''}}];
const provenance={...model,inference:true,requestId:1,instanceId:'test'};
const response=(body,status=200)=>async()=>new Response(body,{status});
test('native identity required; mock and chat output rejected',async()=>{
 for(const body of [JSON.stringify({actionId:'wait'}),JSON.stringify({decision:{actionId:'wait'},provenance:{...provenance,modelId:'mock'}})]){
 assert.equal((await decide({},candidates,{}, {fetchImpl:response(body)})).reason,'unverified_model');
 }
 const r=await decide({},candidates,{}, {fetchImpl:response(JSON.stringify({decision:{actionId:'wait'},provenance}))});
 assert.equal(validateJuliaDecision(r.output,candidates).status,'valid');
});
test('empty/invalid JSON and HTTP errors remain recoverable',async()=>{
 for(const [body,status,expected] of [['',200,'invalid'],['{',200,'invalid'],['{}',500,'error'],['{}',503,'unavailable'],['{}',422,'invalid']])
 assert.equal((await decide({},candidates,{}, {fetchImpl:response(body,status)})).status,expected);
});
test('context overflow rejected before network; coordinates cannot be supplied',async()=>{
 let called=false; const r=await decide({history:'x'.repeat(25000)},candidates,{}, {fetchImpl:async()=>{called=true;}});
 assert.equal(r.reason,'context_excessive');assert.equal(called,false);
 assert.equal(validateJuliaDecision({actionId:'wait',x:200},candidates).status,'invalid');
});
test('observer never waits at enqueue, records exceptions, continues subsequent requests',async()=>{
 let release; const gate=new Promise(r=>release=r);let calls=0;
 const observer=createShadowObserver({source:'mock',decider:async()=>{calls++;await gate;if(calls===1)throw Error('offline');return {status:'response',output:{actionId:'wait'},latencyMs:1};}});
 for(let decision=1;decision<=100;decision++)observer.enqueue({decision,snapshot:{},candidates,rulesDecision:{actionId:'wait'},rulesResult:{ok:true}});
 assert.equal(observer.records().length,0);release();await observer.drain();
 assert.equal(observer.records().length,100);assert.equal(observer.records()[0].status,'error');assert.equal(observer.records()[99].status,'valid');
});
test('real/mock aggregation cannot mix',()=>assert.throws(()=>summarizeShadow([{source:'real'},{source:'mock'}]),/Cannot mix/));
test('reset cancels stale queued inference',async()=>{
 const observer=createShadowObserver({decider:async()=>{throw Error('must not run');}});observer.enqueue({decision:1,snapshot:{},candidates,rulesDecision:{actionId:'wait'},rulesResult:{ok:true}});observer.cancel();await observer.drain();assert.equal(observer.records().length,0);
});
test('cancel aborts in-flight shadow and suppresses stale callbacks', async () => {
 let calls = 0, callbacks = 0, wasAborted = false, started;
 const ready = new Promise(resolve => { started = resolve; });
 const observer = createShadowObserver({source: 'mock', onRecord: () => { callbacks++; },
  decider: async (_snapshot, _candidates, _memory, {signal} = {}) => {
   calls++; started();
   await new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => { wasAborted = true; reject(new DOMException('Canceled', 'AbortError')); }, {once: true});
   });
   return {status: 'response', output: {actionId: 'wait'}, latencyMs: 1};
  }});
 for (let decision = 1; decision <= 2; decision++) observer.enqueue({decision, snapshot: {}, candidates,
  rulesDecision: {actionId: 'wait'}, rulesResult: {ok: true}});
 await ready; observer.cancel();
 assert.equal(wasAborted, true);
 await observer.drain();
 assert.equal(calls, 1); assert.equal(callbacks, 0); assert.equal(observer.records().length, 0);
});
test('client distinguishes caller cancellation and does not fetch after cancellation', async () => {
 const controller = new AbortController(); let started, aborted = false;
 const ready = new Promise(resolve => { started = resolve; });
 const fetchImpl = async (_url, {signal}) => {
  started();
  return await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
   aborted = true; reject(new DOMException('Canceled', 'AbortError'));
  }, {once: true}));
 };
 const reply = decide({}, candidates, {}, {signal: controller.signal, fetchImpl});
 await ready; controller.abort();
 assert.equal((await reply).reason, 'request_cancelled'); assert.equal(aborted, true);
 const result = await decide({}, candidates, {}, {signal: controller.signal,
  fetchImpl: async () => { assert.fail('canceled request must not fetch'); }});
 assert.equal(result.reason, 'request_cancelled');
});
