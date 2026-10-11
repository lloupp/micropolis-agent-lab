import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHarness } from './wasm-harness.mjs';
import { decideRules, advanceMemory, makeInitialMemory } from '../overlay/agent/rules.js';
import { availableActionsFor } from '../overlay/agent/candidates.js';
import { actionId, summarizeShadow } from '../overlay/agent/agents.js';
import { createShadowObserver } from '../overlay/agent/shadow-observer.js';

const decisions = 100;
const ticksPerDecision = 39;
const mapHash = simulator => createHash('sha256')
  .update(JSON.stringify(Array.from(simulator.mapData))).digest('hex');

async function runEpisode(slow) {
  const { simulator, runtime } = await createHarness();
  const m = simulator.micropolis;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const callbacks = [];
  const losses = [];
  const inferenceEvents = [];
  const observer = createShadowObserver({
    source: 'mock',
    ...(slow ? { maxPending: 2, maxRecords: 1 } : {}),
    onRecord: rows => callbacks.push(rows.at(-1)),
    onDrop: event => losses.push(event),
    decider: async (snapshot, candidates, memory) => {
      inferenceEvents.push({ step: memory.step + 1, event: 'start' });
      if (slow) await gate;
      const tool = [['res', snapshot.resValve], ['com', snapshot.comValve], ['ind', snapshot.indValve]]
        .sort((a, b) => b[1] - a[1])[0][0];
      const candidate = candidates.find(item => item.action.tool === tool)
        ?? candidates.find(item => item.id === 'wait');
      assert.ok(candidate, 'Every admitted request must offer a safe mock choice');
      inferenceEvents.push({ step: memory.step + 1, event: 'complete' });
      return { status: 'response', output: { actionId: candidate.id, confidence: 0.5 }, latencyMs: 0 };
    }
  });
  try {
    m.loadCity('/cities/haight.cty');
    runtime.resetLaboratory(simulator);
    simulator.setFramesPerSecond(0);
    const initial = runtime.readSnapshot(simulator);
    assert.equal(initial.cityPop, 0);
    assert.equal(initial.totalFunds, 20000);
    assert.ok(simulator.mapData.every(tile => tile === 0));
    let memory = makeInitialMemory();
    let lastActions = [], failures = [], previousResult = null;
    const rulesActions = [];
    for (let decision = 1; decision <= decisions; decision++) {
      const snapshot = runtime.readSnapshot(simulator);
      const action = decideRules(snapshot, memory);
      const candidates = availableActionsFor(snapshot, action,
        candidate => runtime.isLegalBuildCandidate(simulator, candidate));
      const rulesChoice = { actionId: actionId(action) };
      const result = runtime.executeAction(simulator, action);
      assert.equal(result.ok, true, `Rules action failed at decision ${decision}`);
      rulesActions.push(rulesChoice.actionId);
      const accepted = observer.enqueue({ decision,
        snapshot: { ...snapshot, lastActions, lastActionResult: previousResult, recentFailures: failures },
        candidates, rulesDecision: rulesChoice, rulesResult: result });
      assert.equal(accepted, !slow || decision <= 2, `Unexpected admission at decision ${decision}`);
      if (!result.ok) failures = [result.message, ...failures].slice(0, 5);
      memory = advanceMemory(memory, action);
      lastActions = [{ actionId: rulesChoice.actionId, result: result.message }, ...lastActions].slice(0, 8);
      previousResult = result.message;
      const beforeTime = m.cityTime;
      for (let tick = 0; tick < ticksPerDecision; tick++) simulator.tick();
      assert.ok(m.cityTime > beforeTime, `Simulation stalled at decision ${decision}`);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(memory.step, decisions);
    const beforeDrain = observer.stats();
    const finalBeforeDrain = runtime.readSnapshot(simulator);
    const hashBeforeDrain = mapHash(simulator);
    if (slow) {
      assert.equal(beforeDrain.completed, 0, 'Rules must finish before any slow shadow response');
      assert.equal(beforeDrain.pending, 2);
      assert.equal(beforeDrain.active, true);
      assert.equal(beforeDrain.queued, 1);
      assert.equal(beforeDrain.dropped, 98);
      assert.deepEqual(inferenceEvents, [{ step: 1, event: 'start' }]);
      release();
    }
    await observer.drain();
    const final = runtime.readSnapshot(simulator);
    const hash = mapHash(simulator);
    assert.deepEqual(final, finalBeforeDrain, 'Draining shadow must not change engine state');
    assert.equal(hash, hashBeforeDrain, 'Draining shadow must not change map tiles');
    assert.equal(final.cityPop, 3360);
    assert.equal(final.totalFunds, 15358);
    assert.ok(final.resPop > 0 && final.comPop > 0 && final.indPop > 0);
    assert.ok(final.poweredZoneCount > 0);
    const stats = observer.stats();
    const summary = summarizeShadow(callbacks);
    assert.equal(summary.realInferences, 0);
    assert.equal(summary.errors, 0);
    assert.equal(summary.invalid, 0);
    assert.equal(stats.pending, 0);
    assert.equal(stats.canceledRequests, 0);
    assert.equal(stats.submitted, decisions);
    assert.equal(stats.accepted, slow ? 2 : 100);
    assert.equal(stats.completed, slow ? 2 : 100);
    assert.equal(stats.retained, slow ? 1 : 100);
    assert.equal(stats.evicted, slow ? 1 : 0);
    assert.equal(stats.dropped, slow ? 98 : 0);
    const callbackDecisions = callbacks.map(row => row.decision);
    assert.deepEqual(callbackDecisions, Array.from({ length: slow ? 2 : 100 }, (_, i) => i + 1));
    assert.deepEqual(inferenceEvents, callbackDecisions.flatMap(step => [
      { step, event: 'start' }, { step, event: 'complete' }
    ]));
    assert.deepEqual(losses, slow ? Array.from({ length: 98 }, (_, i) => ({ decision: i + 3, reason: 'queue_full' })) : []);
    assert.deepEqual(observer.records().map(row => row.decision), slow ? [2] : callbackDecisions);
    return { source: 'mock', initial, final, mapSha256: hash, rulesActions, rulesDecisions: memory.step,
      rulesCompletedBeforeDrain: slow && beforeDrain.completed === 0, beforeDrain, stats, summary,
      callbackDecisions, inferenceEvents, losses };
  } finally {
    release();
    observer.cancel();
    simulator.dispose();
  }
}

const baseline = await runEpisode(false);
const saturated = await runEpisode(true);
assert.deepEqual(saturated.initial, baseline.initial, 'Both episodes must start identically');
assert.deepEqual(saturated.rulesActions, baseline.rulesActions, 'Shadow saturation must preserve every Rules decision');
assert.deepEqual(saturated.final, baseline.final, 'Shadow saturation must preserve the final snapshot');
assert.equal(saturated.mapSha256, baseline.mapSha256, 'Shadow saturation must preserve every map tile');
const output = { source: 'mock', executor: 'Rules only', seed: 42, decisions, ticksPerDecision,
  identicalRulesActions: true, identicalFinalSnapshot: true, identicalMap: true, baseline, saturated };
const destination = fileURLToPath(new URL('../artifacts/julia-mock/shadow-capacity.json', import.meta.url));
await mkdir(fileURLToPath(new URL('../artifacts/julia-mock/', import.meta.url)), { recursive: true });
await writeFile(destination, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ source: output.source, executor: output.executor, decisions,
  identicalFinalSnapshot: true, identicalMap: true, mapSha256: saturated.mapSha256,
  population: saturated.final.cityPop, funds: saturated.final.totalFunds,
  saturated: saturated.stats, realInferences: saturated.summary.realInferences }, null, 2));
