import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './wasm-harness.mjs';
import { decideRules, advanceMemory, makeInitialMemory } from '../overlay/agent/rules.js';
import { availableActionsFor } from '../overlay/agent/candidates.js';
import { decide as decideJulia } from '../overlay/agent/julia-client.js';
import {
  actionId, summarizeShadow
} from '../overlay/agent/agents.js';

import { createShadowObserver } from '../overlay/agent/shadow-observer.js';
import { smokeJulia } from './smoke-julia-real.mjs';
const live = !process.argv.includes('--mock');
const endpointIndex = process.argv.indexOf('--endpoint');
const endpoint = endpointIndex >= 0 ? process.argv[endpointIndex + 1] : process.env.JULIA_SHADOW_URL;
const smoke = live ? await smokeJulia(endpoint) : null;
const { simulator, runtime } = await createHarness();
const m = simulator.micropolis;
const observer = createShadowObserver({ source: live ? 'real' : 'mock', decider: live
  ? (snapshot, candidates, memory) => decideJulia(snapshot, candidates, memory, { endpoint })
  : async (snapshot, candidates) => {
      const tool = [['res', snapshot.resValve], ['com', snapshot.comValve], ['ind', snapshot.indValve]].sort((a,b)=>b[1]-a[1])[0][0];
      const candidate = candidates.find(item => item.action.tool === tool) ?? candidates.find(item=>item.id==='wait');
      return {status:'response',output:{actionId:candidate.id,confidence:0.5},latencyMs:0};
    }
});
const checkpoints = [];
let rulesMemory = makeInitialMemory();

let previousResult = null;
let lastActions = [];
let failures = [];
const ticksPerDecision = 39;
try {
  m.loadCity('/cities/haight.cty');
  runtime.resetLaboratory(simulator);
  simulator.setFramesPerSecond(0);
  const initial = runtime.readSnapshot(simulator);
  assert.equal(initial.cityPop, 0);
  assert.equal(initial.totalFunds, 20000);
  assert.ok(simulator.mapData.every((tile) => tile === 0));
  checkpoints.push({ decision: 0, ...initial });

  for (let decision = 1; decision <= 100; decision += 1) {
    const snapshot = runtime.readSnapshot(simulator);
    const rulesAction = decideRules(snapshot, rulesMemory);
    let candidates = [];
    let preparationError = null;
    try { candidates = availableActionsFor(snapshot, rulesAction,
      (candidate) => runtime.isLegalBuildCandidate(simulator, candidate)); }
    catch { preparationError = 'candidate_preparation_error'; }
    const rulesChoice = { actionId: actionId(rulesAction) };
    const result = runtime.executeAction(simulator, rulesAction);

    const modelSnapshot = {
      ...snapshot, lastActions, lastActionResult: previousResult,
      recentFailures: failures
    };
    observer.enqueue({ decision, snapshot: modelSnapshot, candidates, rulesDecision: rulesChoice, rulesResult: result, preparationError });
    if (!result.ok) failures = [result.message, ...failures].slice(0, 5);
    rulesMemory = advanceMemory(rulesMemory, rulesAction);
    lastActions = [{ actionId: rulesChoice.actionId, result: result.message }, ...lastActions].slice(0, 8);
    previousResult = result.message;
    const beforeTime = m.cityTime;
    for (let tick = 0; tick < ticksPerDecision; tick += 1) simulator.tick();
    assert.ok(m.cityTime > beforeTime, `cityTime stalled at decision ${decision}`);
    await new Promise(resolve => setImmediate(resolve));
    if (decision % 25 === 0) checkpoints.push({ decision, ...runtime.readSnapshot(simulator) });
  }

  const rulesCompletedBeforeShadow = observer.records().length < 100;
  await observer.drain();
  const rows = observer.records();
  assert.equal(rows.length, 100);
  assert.equal(rulesMemory.step, 100);
  const final = runtime.readSnapshot(simulator);
  assert.ok(final.cityPop > 0);
  assert.ok(final.poweredZoneCount > 0);
  assert.ok(final.resPop > 0 && final.comPop > 0 && final.indPop > 0);
  assert.equal(failures.length, 0);
  assert.ok(final.simCycle > initial.simCycle);
  assert.ok(m.cityTime > initial.cityTime);
  const summary = summarizeShadow(rows);
  assert.equal(final.cityPop, 3360);
  assert.equal(final.totalFunds, 15358);
  const output = { source: live ? 'real' : 'mock', provenance: smoke?.provenance, rulesCompletedBeforeShadow, model: live ? 'SupersonicLabs/Julia-1' : 'Julia-1 deterministic test mock', executor: 'Rules only', seed: 42,
    decisions: rulesMemory.step, initial, final, checkpoints, summary, rows };
  const dir = live ? 'artifacts/julia-real' : 'artifacts/julia-mock';
  await mkdir(resolve(dir), { recursive: true });
  await writeFile(resolve(dir, 'decisions.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(resolve(dir, 'summary.json'), JSON.stringify({ ...output, rows: undefined }, null, 2));
  console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
  if (live) {
    assert.equal(summary.realInferences, 100, '100 verified real inferences required');
    assert.equal(new Set(rows.map(row => `${row.provenance?.instanceId}:${row.provenance?.requestId}`)).size, 100);
    assert.equal(summary.valid, 100);
  }
} finally {
  simulator.dispose();
}
