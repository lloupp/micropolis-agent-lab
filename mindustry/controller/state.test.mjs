import test from 'node:test';
import assert from 'node:assert/strict';
import {parseState, getState} from './state.mjs';

const good = Object.freeze({
  schemaVersion: 1, ready: true, wave: 3, tick: 128, width: 100, height: 80,
  playing: true, gameOver: false, won: false,
  core: {x: 5, y: 7, health: 4000, copper: 23, lead: 10}
});

test('parses a bounded, typed game snapshot', () => {
  const state = parseState(good);
  assert.equal(state.core.copper, 23);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.core));
  assert.equal(state.wave, 3);
});
test('explicitly represents not-ready state', () => {
  assert.deepEqual(parseState({schemaVersion: 1, ready: false}), {schemaVersion: 1, ready: false});
});
test('rejects invalid and future protocol versions', () => {
  assert.throws(() => parseState({...good, schemaVersion: 2}), /schemaVersion/);
  assert.throws(() => parseState({...good, tick: -1}), /tick/);
  assert.throws(() => parseState({...good, core: {...good.core, x: 500}}), /outside map/);
});
test('reads the loopback bridge without mutating the game', async () => {
  let method;
  const state = await getState({fetchImpl: async (url, options) => {
    assert.equal(url.hostname, '127.0.0.1');
    method = options.method;
    return {ok: true, json: async () => good};
  }});
  assert.equal(method, 'GET');
  assert.equal(state.tick, 128);
});
test('rejects external and non-read-only endpoints', async () => {
  for (const url of ['http://example.com/v1/state', 'http://127.0.0.1:8766/build',
      'https://127.0.0.1:8766/v1/state', 'http://127.0.0.1:8766/v1/state?x=1']) {
    await assert.rejects(getState({url, fetchImpl: () => { throw new Error('should not fetch'); }}));
  }
});
