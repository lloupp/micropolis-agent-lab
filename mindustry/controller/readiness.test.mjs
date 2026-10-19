import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReadiness} from './readiness.mjs';

const state = (tick, override = {}) => ({
  schemaVersion: 1, ready: true, wave: 1, tick, width: 100, height: 80,
  playing: true, gameOver: false, won: false,
  core: {x: 10, y: 10, health: 4000, copper: 10, lead: 0}, ...override
});
function sequence(states) {
  const calls = [];
  return {calls, readState: async () => {
    calls.push('GET');
    const next = states.shift();
    if (!next) throw new Error('Excess GET');
    return next;
  }, pause: async () => calls.push('PAUSE')};
}

test('preflight verifies three advancing real-shaped game snapshots without actions', async () => {
  const input = sequence([state(100), state(101), state(120)]);
  const result = await validateReadiness({...input, intervalMs: 0});
  assert.equal(result.readOnly, true);
  assert.equal(result.commandsExecuted, 0);
  assert.equal(result.gameplayAutonomous, false);
  assert.equal(result.tickStart, 100);
  assert.equal(result.tickEnd, 120);
  assert.deepEqual(input.calls, ['GET', 'PAUSE', 'GET', 'PAUSE', 'GET']);
  assert.ok(Object.isFrozen(result));
});

test('preflight refuses unavailable, nonplaying, coreless or terminal episodes', async () => {
  const invalid = [
    state(5, {ready: false}), state(5, {playing: false}),
    state(5, {core: null}), state(5, {core: {...state(5).core, health: 0}}),
    state(5, {gameOver: true}), state(5, {won: true})
  ];
  for (const item of invalid) {
    await assert.rejects(validateReadiness({...sequence([item, state(6)]), intervalMs: 0, samples: 2}));
  }
});

test('preflight detects stalled, rewound or switched maps', async () => {
  for (const states of [
    [state(10), state(10)],
    [state(12), state(11)],
    [state(10), state(11, {width: 120})],
    [state(10, {wave: 2}), state(11, {wave: 1})]
  ]) {
    await assert.rejects(validateReadiness({...sequence(states), intervalMs: 0, samples: 2}));
  }
});

test('invalid sample counts are rejected before any HTTP', async () => {
  const input = sequence([state(1)]);
  await assert.rejects(validateReadiness({...input, samples: 1}), /Invalid readiness/);
  await assert.rejects(validateReadiness({...input, samples: 100}), /Invalid readiness/);
  assert.deepEqual(input.calls, []);
});
