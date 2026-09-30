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

test('após blueprint escolhe maior demanda', () => {
  const action = decideRules(
    { ...base, resValve: 1500, comValve: 200, indValve: 500 },
    { step: BLUEPRINT_LENGTH, adaptiveIndex: 0 }
  );
  assert.equal(action.kind, 'build');
  assert.equal(action.tool, 'res');
  assert.equal(action.phase, 'adaptive');
});
