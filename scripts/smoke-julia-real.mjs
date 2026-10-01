import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { decide, isRealJuliaProvenance } from '../overlay/agent/julia-client.js';
import { validateJuliaDecision } from '../overlay/agent/agents.js';

export async function smokeJulia(endpoint) {
  const snapshot = {
    cityPop: 0, totalFunds: 20000, cityTax: 7, cityTime: 1, simCycle: 1,
    cityYear: 1900, cityMonth: 0, cityScore: 0,
    resValve: 2000, comValve: -600, indValve: 600, resPop: 0, comPop: 0, indPop: 0,
    crimeAverage: 0, pollutionAverage: 0, trafficAverage: 0, landValueAverage: 0,
    poweredZoneCount: 0, unpoweredZoneCount: 0, cashFlow: 0,
    lastActions: [], lastActionResult: null, recentFailures: []
  };
  const candidates = [
    { id: 'build:coal:36:51', action: { kind: 'build', tool: 'coal', x: 36, y: 51, reason: '' } },
    { id: 'build:res:10:10', action: { kind: 'build', tool: 'res', x: 10, y: 10, reason: '' } },
    { id: 'wait', action: { kind: 'wait', reason: '' } }
  ];
  const reply = await decide(snapshot, candidates, { step: 0, recentSuggestions: [] }, { endpoint });
  assert.equal(reply.status, 'response', `Real Julia smoke failed: ${reply.status} / ${reply.reason}`);
  assert.ok(isRealJuliaProvenance(reply.provenance), 'Pinned native Julia-1 identity must match');
  const validation = validateJuliaDecision(reply.output, candidates);
  assert.equal(validation.status, 'valid', validation.reason);
  const result = { source: 'real', endpoint: reply.endpoint, provenance: reply.provenance,
    latencyMs: reply.latencyMs, normalizedDecision: reply.output, candidate: validation.candidate,
    snapshot, candidates };
  await mkdir(resolve('artifacts/julia-real'), { recursive: true });
  await writeFile(resolve('artifacts/julia-real/smoke.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await smokeJulia(process.env.JULIA_SHADOW_URL), null, 2));
}
