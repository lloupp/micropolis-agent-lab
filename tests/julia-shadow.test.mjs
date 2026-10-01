import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActionsFor } from '../overlay/agent/candidates.js';
import {
  createShadowRecord, detectSuggestedLoop, summarizeShadow, validateJuliaDecision
} from '../overlay/agent/agents.js';
import { decide } from '../overlay/agent/julia-client.js';

const rulesAction = { kind: 'build', tool: 'res', x: 20, y: 30, reason: 'rules' };
const candidates = availableActionsFor({ cityTax: 7 }, rulesAction);

test('Julia pode escolher candidato produzido pelo laboratório', () => {
  const result = validateJuliaDecision({ actionId: 'wait', confidence: 0.8 }, candidates);
  assert.equal(result.status, 'valid');
  assert.equal(result.candidate.id, 'wait');
});

test('candidatos de construção só entram se o validador do mapa os aceitar', () => {
  const filtered = availableActionsFor({ cityTax: 7 }, rulesAction,
    (action) => action.x === 10 && action.y === 10 && action.tool === 'res');
  assert.ok(filtered.some((item) => item.id === 'build:res:10:10'));
  assert.ok(!filtered.some((item) => item.id === 'build:com:10:10'));
  assert.ok(filtered.some((item) => item.id === 'wait'));
});

test('candidato inexistente e payload livre são inválidos', () => {
  assert.equal(validateJuliaDecision({ actionId: 'build:res:1:1' }, candidates).reason, 'candidate_not_available');
  assert.equal(validateJuliaDecision({ actionId: 'wait', command: 'build anything' }, candidates).reason, 'unexpected_fields');
});

test('saída malformada nunca valida', () => {
  for (const output of [null, [], 'wait', {}, { actionId: 'wait', confidence: 3 }]) {
    assert.equal(validateJuliaDecision(output, candidates).status, 'invalid');
  }
});

test('cliente converte timeout e Julia indisponível em estados recuperáveis', async () => {
  const timed = await decide({}, candidates, {}, { timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) });
  assert.equal(timed.status, 'timeout');
  const unavailable = await decide({}, candidates, {}, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(unavailable.status, 'unavailable');
});

test('repetição improdutiva é detectada sem executar a sugestão', () => {
  const previous = Array.from({ length: 2 }, () => ({ juliaActionId: 'wait' }));
  assert.equal(detectSuggestedLoop(previous, 'wait', {}, {}).possibleLoop, false);
  const actionId = 'build:res:20:30';
  const loop = detectSuggestedLoop([
    { juliaActionId: actionId }, { juliaActionId: actionId }
  ], actionId, { actionId }, { ok: false });
  assert.deepEqual(loop, { possibleLoop: true, unproductive: true, repeats: 3 });
});

test('falha/unavailability usa fallback Rules como única ação escolhida', () => {
  const row = createShadowRecord({ decision: 1, snapshot: { cityPop: 0 },
    rulesDecision: { actionId: candidates[0].id }, rulesResult: { ok: true },
    validation: { status: 'unavailable', reason: 'unavailable', candidate: null }, latencyMs: 0 });
  assert.equal(row.chosenActionId, candidates[0].id);
  assert.equal(row.fallback, true);
  assert.equal(summarizeShadow([row]).unavailable, 1);
});
