import test from 'node:test';import assert from 'node:assert/strict';
import {candidateFeatures,classifySpatial,intentOf} from '../overlay/agent/spatial.js';
import {evaluateSpatial} from '../overlay/agent/evaluation.js';
const green={rulesIsolated:true,testsGreen:true,checkGreen:true,ciGreen:true};
const good={decisions:100,realInferences:100,valid:100,invalid:0,errors:0,timeouts:0,latencyMs:{average:403,p95:471},spatialPlausibility:0.95,possibleLoops:25,agreementRate:0.1,intentAgreement:0.35,consecutiveRepeatRate:0.1,blockedByValidator:0};
test('exactly frozen thresholds and precedence',()=>{
 assert.equal(evaluateSpatial(good,green).result,'MELHOROU MUITO');
 for(const patch of [{errors:1},{timeouts:2},{valid:98},{invalid:2},{possibleLoops:60},{spatialPlausibility:0.79},{latencyMs:{average:551,p95:471}},{latencyMs:{average:403,p95:651}}])assert.equal(evaluateSpatial({...good,...patch},green).result,'REGRESSÃO');
 assert.equal(evaluateSpatial(good,{...green,ciGreen:false}).result,'BLOQUEADO');
 assert.equal(evaluateSpatial(good,{...green,rulesIsolated:false}).result,'REGRESSÃO');
 const neutral={...good,spatialPlausibility:0.85,possibleLoops:50,agreementRate:0,intentAgreement:0.2,consecutiveRepeatRate:0.3};assert.equal(evaluateSpatial(neutral,green).result,'NEUTRO');
 assert.equal(evaluateSpatial({...neutral,agreementRate:0.2,intentAgreement:0.4},green).result,'NEUTRO');
 assert.equal(evaluateSpatial({...neutral,spatialPlausibility:0.9,intentAgreement:0.3},green).result,'MELHOROU');
 assert.equal(evaluateSpatial({...good,latencyMs:{average:484,p95:500}},green).result,'MELHOROU');
});
test('intent ignores coordinates, preserves build category',()=>{assert.equal(intentOf('build:road:40:50'),intentOf('build:road:42:50'));assert.notEqual(intentOf('build:road:40:50'),intentOf('build:wire:40:50'));});
test('distant legal zones are implausible; footprint and supply connectivity matter',()=>{
 const map=new Map([['5,5',745|16384],['6,5',208|16384],['9,9',208|16384],['7,3',66]]);
 const actions=[{id:'build:res:8:5',action:{kind:'build',tool:'res',x:8,y:5,reason:''}},{id:'build:res:16:16',action:{kind:'build',tool:'res',x:16,y:16,reason:''}},{id:'build:wire:10:9',action:{kind:'build',tool:'wire',x:10,y:9,reason:''}}];
 const f=candidateFeatures((x,y)=>map.get(`${x},${y}`)??0,20,20,actions,20000);
 assert.equal(f[0].roadDistance,1);assert.equal(f[0].powerDistance,1);assert.equal(classifySpatial(actions[0].id,f).spatiallyPlausible,true);
 assert.equal(classifySpatial(actions[1].id,f).spatiallyPlausible,false);assert.equal(classifySpatial(actions[2].id,f).spatiallyPlausible,false);
 assert.equal(f[2].powerDistance,8,'isolated wire must not count as supply');
 const noMoney=candidateFeatures(()=>0,20,20,actions,0);assert.equal(noMoney[0].legal,false);
});
