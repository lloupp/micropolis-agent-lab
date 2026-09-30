import assert from 'node:assert/strict';
import { createHarness } from './wasm-harness.mjs';
const { simulator: s, runtime } = await createHarness();
const m = s.micropolis;
const originalDebug = console.debug;
console.debug = () => {};
try {
  // Reproduce the exact $6,683 increase with controlled inherited census.
  // This is a regression fixture, not a recovered historical browser snapshot.
  m.clearMap(); m.cityTime = 0; m.phaseCycle = 9;
  m.totalPop = 1364; m.landValueAverage = 60;
  m.roadTotal = 0; m.railTotal = 0; m.policeStationPop = 0; m.fireStationPop = 0;
  m.setCityTax(7); m.setAutoBudget(true); m.setSpeed(3);
  m.totalFunds = 20000;
  assert.equal(m.totalFunds, 20000);
  m.updateFunds(); assert.equal(m.totalFunds, 20000);
  m.simTick(); assert.equal(m.totalFunds, 26683);
  assert.equal(m.cashFlow, 6683);
  console.log('Old reset: updateFunds=$20000, phase-9 tick=$26683, cashFlow=$6683');

  // Reset during every phase of a previously loaded, populated city.
  for (let phase = 0; phase < 16; phase++) {
    m.loadCity('/cities/haight.cty'); m.phaseCycle = phase;
    m.cityPop = 213860; m.totalPop = 1364; m.landValueAverage = 60;
    m.cashFlow = 6683;
    runtime.resetLaboratory(s);
    assert.equal(s.framesPerSecond, 60);
    assert.equal(m.simSpeed, 3);
    s.setFramesPerSecond(0);
    const snapshot = runtime.readSnapshot(s);
    assert.equal(snapshot.cityPop, 0);
    assert.equal(snapshot.totalFunds, 20000);
    assert.ok(s.mapData.every(tile => tile === 0));
    const trace = runtime.getResetTrace(s);
    assert.deepEqual(trace.map(e => e.stage), ['before','assignment','updateFunds','resume/setPaused(false)','after 1 tick','AgentPanel']);
    for (const entry of trace.slice(1)) assert.equal(entry.totalFunds, 20000);
    for (let tick = 0; tick < 32; tick++) s.tick();
    assert.equal(m.totalFunds, 20000); assert.equal(m.cityPop, 0);
  }
  // Real pause API prevents the simulator's unconditional tick from advancing.
  m.pause(); const before = m.cityTime;
  s.setPaused(true); for (let tick = 0; tick < 32; tick++) s.tick();
  assert.equal(m.cityTime, before);
  console.log('PASS: reset for all 16 phases, empty map, $20000, no inherited budget, engine pause');
} finally { console.debug = originalDebug; s.dispose(); }
