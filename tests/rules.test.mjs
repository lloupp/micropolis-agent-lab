import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUEPRINT_LENGTH,
  advanceMemory,
  decideRules,
  makeInitialMemory
} from '../overlay/agent/rules.js';

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
  const next = advanceMemory(memory, action);
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
    action
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
