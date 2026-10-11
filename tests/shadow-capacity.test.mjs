import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowObserver } from '../overlay/agent/shadow-observer.js';

const candidates = [{ id: 'tax:7', action: { kind: 'tax', value: 7 } }];
const request = decision => ({ decision, snapshot: { cityPop: decision }, candidates,
  rulesDecision: { actionId: 'tax:7' }, rulesResult: { ok: true } });
const reply = () => ({ status: 'response', output: { actionId: 'tax:7' }, latencyMs: 1 });

test('slow shadow caps pending requests and reports every rejection without cloning rejected snapshots', async () => {
  let release, started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const losses = [];
  const observer = createShadowObserver({ source: 'mock', maxPending: 2, maxRecords: 3,
    onDrop: event => losses.push(event),
    decider: async () => { calls++; started(); await gate; return reply(); } });
  assert.equal(observer.enqueue(request(1)), true);
  assert.equal(observer.enqueue(request(2)), true);
  await ready;
  assert.equal(observer.stats().pending, 2);
  assert.equal(observer.stats().queued, 1);
  for (let decision = 3; decision <= 1002; decision++) {
    const rejected = request(decision);
    Object.defineProperty(rejected, 'snapshot', { enumerable: true, get() { assert.fail('rejected payload must not be cloned'); } });
    assert.equal(observer.enqueue(rejected), false);
  }
  assert.equal(calls, 1);
  assert.equal(observer.stats().dropped, 1000);
  assert.equal(observer.stats().lastDroppedDecision, 1002);
  assert.equal(losses.length, 1000);
  assert.deepEqual(losses[0], { decision: 3, reason: 'queue_full' });
  release(); await observer.drain();
  assert.deepEqual(observer.records().map(row => row.decision), [1, 2]);
  assert.equal(observer.stats().pending, 0);
  assert.equal(observer.enqueue(request(1003)), true);
  await observer.drain();
  assert.equal(observer.stats().completed, 3);
  assert.equal(observer.stats().submitted, 1003);
});

test('retention is bounded while loop streaks, memory, callbacks and accounting remain accurate', async () => {
  let maxCallbackLength = 0, memoryStep = 0;
  const observer = createShadowObserver({ source: 'mock', maxRecords: 2,
    onRecord: rows => {
      maxCallbackLength = Math.max(maxCallbackLength, rows.length);
      rows[0].juliaActionId = 'corrupted';
      rows[0].snapshot.cityPop = -1;
    },
    decider: async (_snapshot, _candidates, memory) => { memoryStep = memory.step; return reply(); } });
  for (let decision = 1; decision <= 1000; decision++) {
    observer.enqueue(request(decision)); await observer.drain();
    assert.ok(observer.records().length <= 2);
  }
  const rows = observer.records();
  assert.equal(maxCallbackLength, 2);
  assert.equal(memoryStep, 999);
  assert.equal(rows[1].juliaActionId, 'tax:7');
  assert.equal(rows[1].repeatCount, 1000);
  assert.equal(rows[1].possibleLoop, true);
  assert.equal(rows[1].unproductiveLoop, false);
  assert.equal(rows[1].snapshot.cityPop, 1000);
  rows[1].snapshot.cityPop = -2;
  assert.equal(observer.records()[1].snapshot.cityPop, 1000);
  assert.equal(observer.stats().retained, 2);
  assert.equal(observer.stats().evicted, 998);
  assert.equal(observer.stats().completed, 1000);
  assert.equal(observer.stats().dropped, 0);
});

test('cancel releases queued snapshots and accounts active cancellation', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const observer = createShadowObserver({ source: 'mock', decider: async (_s, _c, _m, { signal }) => {
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true }));
    return reply();
  }});
  observer.enqueue(request(1)); observer.enqueue(request(2)); await ready;
  observer.cancel();
  assert.equal(observer.stats().queued, 0);
  assert.equal(observer.stats().pending, 0);
  assert.equal(observer.stats().canceledRequests, 2);
  assert.equal(observer.enqueue(request(3)), false);
  await observer.drain();
  assert.equal(observer.records().length, 0);
  assert.equal(observer.stats().submitted, 2);
});

test('default capacity preserves all 100 benchmark decisions with no losses', async () => {
  const observer = createShadowObserver({ source: 'mock', decider: async () => reply() });
  for (let decision = 1; decision <= 100; decision++) assert.equal(observer.enqueue(request(decision)), true);
  await observer.drain();
  assert.equal(observer.records().length, 100);
  assert.equal(observer.stats().completed, 100);
  assert.equal(observer.stats().dropped, 0);
  assert.equal(observer.stats().evicted, 0);
});

test('invalid limits are rejected and observer callbacks cannot stop processing', async () => {
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createShadowObserver({ maxPending: value }), RangeError);
    assert.throws(() => createShadowObserver({ maxRecords: value }), RangeError);
  }
  const observer = createShadowObserver({ source: 'mock', maxPending: 1, decider: async () => reply(),
    onRecord: () => { throw Error('UI'); }, onState: () => { throw Error('UI'); }, onDrop: () => { throw Error('UI'); } });
  assert.equal(observer.enqueue(request(1)), true);
  assert.equal(observer.enqueue(request(2)), false);
  await observer.drain();
  assert.equal(observer.stats().completed, 1);
  assert.equal(observer.stats().dropped, 1);
});

test('malformed custom replies are recorded and cannot strand the queue', async () => {
  const replies = [null, undefined, { status: 'invented', latencyMs: 0 }, { status: 'response', latencyMs: NaN }, reply()];
  const observer = createShadowObserver({ source: 'mock', decider: async () => replies.shift() });
  for (let decision = 1; decision <= 5; decision++) observer.enqueue(request(decision));
  await observer.drain();
  const rows = observer.records();
  assert.equal(rows.length, 5);
  assert.ok(rows.slice(0, 4).every(row => row.status === 'error' && row.invalidReason === 'invalid_decider_reply'));
  assert.equal(rows[4].status, 'valid');
  assert.equal(observer.stats().pending, 0);
});

test('cancel accounts queued requests before worker starts and ignores a late reply', async () => {
  const queued = createShadowObserver({ decider: async () => { assert.fail('canceled queue must not run'); } });
  queued.enqueue(request(1)); queued.enqueue(request(2)); queued.cancel(); queued.cancel();
  await queued.drain();
  assert.equal(queued.stats().canceledRequests, 2);
  assert.equal(queued.stats().pending, 0);
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const late = createShadowObserver({ source: 'mock', decider: async () => { started(); await gate; return reply(); } });
  late.enqueue(request(1)); await ready; late.cancel(); release(); await late.drain();
  assert.equal(late.stats().completed, 0);
  assert.equal(late.stats().canceledRequests, 1);
  assert.equal(late.records().length, 0);
});
