import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUEPRINT_LENGTH,
  advanceMemory,
  decideRules,
  makeInitialMemory
} from '../overlay/agent/rules.js';

const success = {ok: true, code: 1, message: 'Construção concluída.'};
const failure = {ok: false, code: 0, message: 'Construção falhou.'};

const base = {
  totalFunds: 20000,
  cityPop: 0,
  cityTax: 7,
  cityScore: 0,
  resValve: 0,
  comValve: 0,
  indValve: 0,
  crimeAverage: 0,
  pollutionAverage: 0,
  trafficAverage: 0,
  landValueAverage: 0,
  poweredZoneCount: 0,
  unpoweredZoneCount: 0,
  cashFlow: 0
};

test('blueprint começa pela usina', () => {
  const action = decideRules(base, makeInitialMemory());
  assert.equal(action.kind, 'build');
  assert.equal(action.tool, 'coal');
  assert.equal(action.x, 36);
  assert.equal(action.y, 51);
});

test('rede elétrica começa adjacente à usina', () => {
  const action = decideRules(base, { step: 1, adaptiveIndex: 0, policeBuilt: false });
  assert.equal(action.kind, 'build');
  assert.equal(action.tool, 'wire');
  assert.equal(action.x, 39);
});

test('memória avança deterministicamente', () => {
  const memory = makeInitialMemory();
  const action = decideRules(base, memory);
  const next = advanceMemory(memory, action, success);
  assert.equal(next.step, 1);
  assert.equal(next.adaptiveIndex, 0);
});

test('após blueprint caixa baixo aumenta imposto', () => {
  const action = decideRules(
    { ...base, totalFunds: 1000, cityTax: 7 },
    { step: BLUEPRINT_LENGTH, adaptiveIndex: 0 }
  );
  assert.equal(action.kind, 'tax');
  assert.equal(action.value, 8);
});

test('delegacia não entra em loop', () => {
  const action = decideRules(
    { ...base, crimeAverage: 150 },
    { step: BLUEPRINT_LENGTH, adaptiveIndex: 0, policeBuilt: false }
  );
  assert.equal(action.tool, 'police');
  const next = advanceMemory(
    { step: BLUEPRINT_LENGTH, adaptiveIndex: 0, policeBuilt: false },
    action, success
  );
  assert.equal(next.policeBuilt, true);
  const second = decideRules(
    { ...base, crimeAverage: 150 },
    next
  );
  assert.notEqual(second.tool, 'police');
});

test('após blueprint escolhe maior demanda', () => {
  const action = decideRules(
    { ...base, resValve: 1500, comValve: 200, indValve: 500 },
    { step: BLUEPRINT_LENGTH, adaptiveIndex: 0 }
  );
  assert.equal(action.kind, 'build');
  assert.equal(action.tool, 'res');
  assert.equal(action.phase, 'adaptive');
});

test('failed blueprint build does not advance the blueprint cursor or reuse decision ID', () => {
  const initial = makeInitialMemory();
  const first = decideRules(base, initial);
  const failed = advanceMemory(initial, first, failure);
  assert.equal(failed.step, 1);
  assert.equal(failed.blueprintIndex, 0);
  assert.equal(failed.failedBuildAttempts, 1);
  assert.deepEqual(decideRules(base, failed), first);
  const retried = advanceMemory(failed, decideRules(base, failed), success);
  assert.equal(retried.step, 2);
  assert.equal(retried.blueprintIndex, 1);
  assert.equal(retried.failedBuildAttempts, 0);
  assert.equal(decideRules(base, retried).tool, 'wire');
});

test('failed police construction is not recorded as built and is retried', () => {
  const initial = {...makeInitialMemory(), blueprintIndex: BLUEPRINT_LENGTH, step: BLUEPRINT_LENGTH};
  const snapshot = {...base, crimeAverage: 150};
  const action = decideRules(snapshot, initial);
  assert.equal(action.tool, 'police');
  const failed = advanceMemory(initial, action, failure);
  assert.equal(failed.policeBuilt, false);
  assert.equal(failed.adaptiveIndex, 0);
  assert.equal(decideRules(snapshot, failed).tool, 'police');
  const passed = advanceMemory(failed, action, success);
  assert.equal(passed.policeBuilt, true);
  assert.notEqual(decideRules(snapshot, passed).tool, 'police');
});

test('failed adaptive zone build does not consume a site', () => {
  const initial = {...makeInitialMemory(), blueprintIndex: BLUEPRINT_LENGTH, step: BLUEPRINT_LENGTH};
  const snapshot = {...base, resValve: 1500};
  const action = decideRules(snapshot, initial);
  assert.equal(action.x, 63);
  const failed = advanceMemory(initial, action, failure);
  assert.equal(failed.adaptiveIndex, 0);
  assert.equal(decideRules(snapshot, failed).x, 63);
  const passed = advanceMemory(failed, action, success);
  assert.equal(passed.adaptiveIndex, 1);
  assert.equal(decideRules(snapshot, passed).x, 66);
});

test('three failed builds block repeated construction without claiming success', () => {
  let memory = makeInitialMemory();
  for (let i = 0; i < 3; i++) {
    const action = decideRules(base, memory);
    assert.equal(action.tool, 'coal');
    memory = advanceMemory(memory, action, failure);
  }
  assert.equal(memory.step, 3);
  assert.equal(memory.blueprintIndex, 0);
  assert.equal(memory.failedBuildAttempts, 3);
  const blocked = decideRules(base, memory);
  assert.equal(blocked.kind, 'wait');
  assert.equal(blocked.phase, 'blocked');
  const next = advanceMemory(memory, blocked, {ok:true, code:null, message:'Aguardando'});
  assert.equal(next.step, 4);
  assert.equal(next.failedBuildAttempts, 3);
  assert.equal(decideRules(base, next).phase, 'blocked');
});

test('missing execution result fails closed rather than assuming build success', () => {
  const memory = makeInitialMemory();
  assert.throws(() => advanceMemory(memory, decideRules(base, memory)), /ExecutionResult/);
});
