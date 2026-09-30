import assert from 'node:assert/strict';
import { createHarness } from './wasm-harness.mjs';
const { simulator: s, runtime, engine } = await createHarness();
try {
  s.micropolis.loadCity('/cities/haight.cty');
  runtime.resetLaboratory(s); s.setFramesPerSecond(0);
  const initial = runtime.readSnapshot(s);
  assert.equal(initial.cityPop, 0); assert.equal(initial.totalFunds, 20000);
  assert.ok(s.mapData.every(t => t === 0));
  const result = s.micropolis.doTool(engine.EditingTool.TOOL_COALPOWER,36,51);
  assert.equal(result.value, 1); assert.equal(s.micropolis.totalFunds,17000);
  for (let tick=0;tick<32;tick++) s.tick();
  assert.ok(s.micropolis.cityTime > initial.cityTime);
  assert.ok(s.micropolis.simCycle > initial.simCycle);
  console.log('PASS: main smoke, empty reset=$20000, direct engine construction=$17000, clocks advance');
} finally { s.dispose(); }
