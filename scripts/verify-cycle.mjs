import assert from 'node:assert/strict';
import { createHarness } from './wasm-harness.mjs';
import { makeInitialMemory, decideRules, advanceMemory } from '../overlay/agent/rules.js';
const { simulator: s, runtime } = await createHarness();
const m = s.micropolis;
try {
  m.loadCity('/cities/haight.cty');
  runtime.resetLaboratory(s);
  const ticksPerDecision = Math.round(s.framesPerSecond * 0.650);
  assert.equal(ticksPerDecision, 39);
  s.setFramesPerSecond(0);
  let memory = makeInitialMemory();
  const initial = runtime.readSnapshot(s);
  assert.equal(memory.step, 0); assert.equal(initial.cityPop, 0);
  assert.equal(initial.totalFunds, 20000); assert.ok(s.mapData.every(t => t === 0));
  const checkpoints = [{ decisions: 0, ...initial }];
  const builds = new Set();
  const developed = { resPop: 0, comPop: 0, indPop: 0 };
  const actions = [];
  // Production cadence: speed 4 = 60 FPS, decision interval = 650 ms.
  for (let decision = 1; decision <= 100; decision++) {
    const before = runtime.readSnapshot(s);
    const action = decideRules(before, memory);
    const result = runtime.executeAction(s, action);
    assert.ok(result.ok, `decision ${decision}: ${JSON.stringify({action, result})}`);
    if (action.kind === 'build') {
      const key = `${action.tool}:${action.x}:${action.y}`;
      assert.ok(!builds.has(key), `repeated construction: ${key}`); builds.add(key);
      assert.ok(m.totalFunds < before.totalFunds, 'construction must debit the engine balance');
    }
    memory = advanceMemory(memory, action);
    assert.equal(memory.step, decision);
    const time = m.cityTime;
    for (let tick = 0; tick < ticksPerDecision; tick++) {
      s.tick();
      for (const key of Object.keys(developed)) developed[key] = Math.max(developed[key], m[key]);
    }
    assert.ok(m.cityTime > time, 'no stationary waits or simulation loops');
    actions.push({ decision, action, result, funds: m.totalFunds });
    if (decision % 25 === 0) checkpoints.push({ decisions: decision, ...runtime.readSnapshot(s) });
  }
  const final = runtime.readSnapshot(s);
  assert.ok(final.cityPop > 0); assert.ok(final.cityTime > initial.cityTime);
  assert.ok(final.simCycle > initial.simCycle);
  for (const population of Object.values(developed)) assert.ok(population > 0, 'all R/C/I must develop');
  for (const x of [42,45,48,51,54,57,60,63,66]) {
    assert.ok(m.getTile(x,48) & 0x8000, `zone ${x} must have power`);
    assert.ok(m.getTile(x,48) & 0x0400, `zone ${x} center must exist`);
    const road = m.getTile(x,46) & 0x03ff;
    assert.ok(road >= 64 && road <= 206, `zone ${x} must have road access`);
  }
  console.log(JSON.stringify({ result: 'SUCCESS', decisions: memory.step,
    initial, final, developed, resetTrace: runtime.getResetTrace(s), checkpoints, actions }, null, 2));
} finally { s.dispose(); }
