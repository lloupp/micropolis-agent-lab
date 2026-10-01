import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './wasm-harness.mjs';
import { decideRules, advanceMemory, makeInitialMemory } from '../overlay/agent/rules.js';
import { availableActionsFor } from '../overlay/agent/candidates.js';
import { decide as decideJulia } from '../overlay/agent/julia-client.js';
import {
  advanceJuliaMemory, createShadowRecord, ruleDecision, summarizeShadow,
  validateJuliaDecision
} from '../overlay/agent/agents.js';

const live = process.argv.includes('--live');
const endpointIndex = process.argv.indexOf('--endpoint');
const endpoint = endpointIndex >= 0 ? process.argv[endpointIndex + 1] : undefined;
const { simulator, runtime } = await createHarness();
const m = simulator.micropolis;
const rows = [];
const checkpoints = [];
let rulesMemory = makeInitialMemory();
let juliaMemory = { step: 0, recentSuggestions: [] };
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
    const candidates = availableActionsFor(snapshot, rulesAction,
      (candidate) => runtime.isLegalBuildCandidate(simulator, candidate));
    const rulesChoice = ruleDecision(snapshot, candidates, rulesMemory, decideRules);
    const result = runtime.executeAction(simulator, rulesAction);
    if (!result.ok) failures = [result.message, ...failures].slice(0, 5);
    const modelSnapshot = {
      ...snapshot, lastActions, lastActionResult: previousResult,
      recentFailures: failures
    };
    const demandTool = [['res', snapshot.resValve], ['com', snapshot.comValve], ['ind', snapshot.indValve]]
      .sort((a, b) => b[1] - a[1])[0][0];
    const mockCandidate = candidates.find((item) => item.action.tool === demandTool) ?? candidates.find((item) => item.id === 'wait');
    const reply = live
      ? await decideJulia(modelSnapshot, candidates, juliaMemory, { endpoint })
      : { status: 'response', output: { actionId: mockCandidate.id, confidence: 0.5 }, latencyMs: 0.1 };
    const validation = reply.status === 'response'
      ? validateJuliaDecision(reply.output, candidates)
      : { status: reply.status, reason: reply.status, candidate: null };
    const row = createShadowRecord({
      decision, snapshot: modelSnapshot, rulesDecision: rulesChoice, rulesResult: result,
      validation, rawDecision: reply.output, latencyMs: reply.latencyMs, previousRecords: rows
    });
    rows.push(row);
    juliaMemory = advanceJuliaMemory(juliaMemory, row.juliaActionId);
    rulesMemory = advanceMemory(rulesMemory, rulesAction);
    lastActions = [{ actionId: rulesChoice.actionId, result: result.message }, ...lastActions].slice(0, 8);
    previousResult = result.message;
    const beforeTime = m.cityTime;
    for (let tick = 0; tick < ticksPerDecision; tick += 1) simulator.tick();
    assert.ok(m.cityTime > beforeTime, `cityTime stalled at decision ${decision}`);
    if (decision % 25 === 0) checkpoints.push({ decision, ...runtime.readSnapshot(simulator) });
  }

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
  const output = { model: live ? 'Julia-1 endpoint' : 'Julia-1 deterministic test mock', executor: 'Rules only', seed: 42,
    decisions: rulesMemory.step, initial, final, checkpoints, summary, rows };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/julia-shadow.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  await writeFile(resolve('artifacts/julia-shadow-summary.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
} finally {
  simulator.dispose();
}
