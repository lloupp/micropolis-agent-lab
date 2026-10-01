/** @typedef {import('./runtime').AgentAction} AgentAction */
/** @typedef {import('./runtime').AgentSnapshot} AgentSnapshot */
/** @typedef {{id: string, action: AgentAction}} Candidate */
/** @typedef {AgentSnapshot & {lastActions?: Array<{actionId: string|null, result: string}>, lastActionResult?: string|null, recentFailures?: string[]}} ModelSnapshot */
/** @typedef {{status: 'valid'|'invalid'|'timeout'|'unavailable'|'error', reason: string|null, candidate: Candidate|null}} Validation */
/** @typedef {{decision: number, status: string, invalidReason: string|null, rulesActionId: string|null, juliaActionId: string|null, agreement: boolean|null, chosenActionId: string|null, confidence: number|null, latencyMs: number, fallback: boolean, possibleLoop: boolean, unproductiveLoop: boolean, repeatCount: number, snapshot: Record<string, unknown>, rulesResult: {ok: boolean, code: number|null}, source: 'real'|'mock', provenance: Record<string, any>|null, endpoint: string|null}} ShadowRecord */

/** Shared, deliberately small action interface for model and rule agents. */
/** @param {AgentAction|null|undefined} action */
export function actionId(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.kind === 'build') {
    if (typeof action.tool !== 'string' || !Number.isInteger(action.x) || !Number.isInteger(action.y)) return null;
    return `build:${action.tool}:${action.x}:${action.y}`;
  }
  if (action.kind === 'tax' && Number.isInteger(action.value)) return `tax:${action.value}`;
  if (action.kind === 'wait') return 'wait';
  return null;
}

/** @param {AgentSnapshot} snapshot @param {Candidate[]} availableActions @param {unknown} memory
 * @param {(snapshot: AgentSnapshot, memory: any) => AgentAction} decideRules
 */
export function ruleDecision(snapshot, availableActions, memory, decideRules) {
  const action = decideRules(snapshot, memory);
  const id = actionId(action);
  const candidate = availableActions.find((item) => item.id === id);
  // Rules retains its established deterministic plan. A missing candidate is
  // reported as an invariant violation; shadow validation never alters it.
  return { actionId: candidate?.id ?? null, action, confidence: 1 };
}

/** @param {unknown} output @param {Candidate[]} availableActions @returns {Validation} */
export function validateJuliaDecision(output, availableActions) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { status: 'invalid', reason: 'decision_not_object', candidate: null };
  }
  /** @type {{actionId?: unknown, confidence?: unknown, reason?: unknown}} */
  const decision = output;
  const keys = Object.keys(output);
  if (keys.some((key) => !['actionId', 'confidence', 'reason'].includes(key))) {
    return { status: 'invalid', reason: 'unexpected_fields', candidate: null };
  }
  if (typeof decision.actionId !== 'string') {
    return { status: 'invalid', reason: 'missing_action_id', candidate: null };
  }
  if (decision.confidence !== undefined &&
      (typeof decision.confidence !== 'number' || !Number.isFinite(decision.confidence) ||
       decision.confidence < 0 || decision.confidence > 1)) {
    return { status: 'invalid', reason: 'invalid_confidence', candidate: null };
  }
  if (decision.reason !== undefined &&
      (typeof decision.reason !== 'string' || decision.reason.length > 280)) {
    return { status: 'invalid', reason: 'invalid_reason', candidate: null };
  }
  const candidate = availableActions.find((item) => item.id === decision.actionId);
  if (!candidate) return { status: 'invalid', reason: 'candidate_not_available', candidate: null };
  return { status: 'valid', reason: null, candidate };
}

/** @returns {{step: number, recentSuggestions: string[]}} */
export function createJuliaMemory() {
  return { step: 0, recentSuggestions: [] };
}

/** @param {{step: number, recentSuggestions: string[]}} memory @param {string|null} suggestionId */
export function advanceJuliaMemory(memory, suggestionId) {
  const recentSuggestions = suggestionId
    ? [...memory.recentSuggestions, suggestionId].slice(-10)
    : memory.recentSuggestions;
  return { step: memory.step + 1, recentSuggestions };
}

/** A repeat is only called unproductive when Rules actually tried and failed it. */
/** @param {ShadowRecord[]} records @param {string|null} candidateId
 * @param {{actionId: string|null}|null} rulesDecision @param {{ok?: boolean}|null} rulesResult
 */
export function detectSuggestedLoop(records, candidateId, rulesDecision, rulesResult) {
  if (!candidateId || candidateId === 'wait') return { possibleLoop: false, unproductive: false, repeats: 0 };
  let repeats = 0;
  for (let i = records.length - 1; i >= 0 && records[i].juliaActionId === candidateId; i -= 1) repeats += 1;
  repeats += 1;
  const sameFailedAction = rulesDecision?.actionId === candidateId && rulesResult?.ok === false;
  return {
    possibleLoop: repeats >= 3,
    unproductive: repeats >= 3 && sameFailedAction,
    repeats
  };
}

/** @param {{decision: number, snapshot: ModelSnapshot, rulesDecision: {actionId: string|null}, rulesResult: {ok?: boolean, code?: number|null}, validation: Validation, rawDecision?: {confidence?: number}|null, latencyMs: number, previousRecords?: ShadowRecord[], source?: 'real'|'mock', provenance?: Record<string, any>|null, endpoint?: string|null}} args
 * @returns {ShadowRecord}
 */
export function createShadowRecord({
  decision, snapshot, rulesDecision, rulesResult, validation, rawDecision, latencyMs,
  previousRecords = [], source = 'real', provenance = null, endpoint = null
}) {
  const juliaActionId = validation.candidate?.id ?? null;
  const loop = detectSuggestedLoop(previousRecords, juliaActionId, rulesDecision, rulesResult);
  return {
    decision,
    source, provenance, endpoint,
    status: validation.status,
    invalidReason: validation.reason,
    rulesActionId: rulesDecision.actionId,
    juliaActionId,
    agreement: validation.status === 'valid' ? juliaActionId === rulesDecision.actionId : null,
    chosenActionId: rulesDecision.actionId,
    confidence: validation.status === 'valid' ? rawDecision?.confidence ?? null : null,
    latencyMs,
    fallback: validation.status !== 'valid',
    possibleLoop: loop.possibleLoop,
    unproductiveLoop: loop.unproductive,
    repeatCount: loop.repeats,
    snapshot: {
      ...compactSnapshot(snapshot),
      lastActions: (snapshot.lastActions ?? []).slice(-8),
      lastActionResult: snapshot.lastActionResult ?? null,
      recentFailures: (snapshot.recentFailures ?? []).slice(-5)
    },
    rulesResult: { ok: Boolean(rulesResult?.ok), code: rulesResult?.code ?? null }
  };
}

/** @param {AgentSnapshot} snapshot @returns {Record<string, number>} */
export function compactSnapshot(snapshot) {
  const scalarFields = [
    'cityPop', 'totalFunds', 'cityTax', 'cityTime', 'simCycle',
    'resValve', 'comValve', 'indValve', 'resPop', 'comPop', 'indPop',
    'crimeAverage', 'pollutionAverage', 'trafficAverage', 'landValueAverage',
    'poweredZoneCount', 'unpoweredZoneCount', 'cashFlow'
  ];
  const values = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (snapshot));
  return Object.fromEntries(scalarFields.map((field) => [field, Number(values[field] ?? 0)]));
}

/** @param {ShadowRecord[]} records */
export function summarizeShadow(records) {
  if (new Set(records.map((row) => row.source)).size > 1) throw new Error('Cannot mix real and mock metrics');
  const valid = records.filter((/** @type {ShadowRecord} */ row) => row.status === 'valid');
  const sortedLatency = records.map((/** @type {ShadowRecord} */ row) => row.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (/** @type {number} */ p) => sortedLatency.length
    ? sortedLatency[Math.max(0, Math.ceil(p * sortedLatency.length) - 1)] : null;
  const counts = (/** @type {(row: ShadowRecord) => boolean} */ predicate) => records.filter(predicate).length;
  /** @type {Record<string, number>} */
  const categories = {};
  for (const row of valid) {
    const actionId = row.juliaActionId ?? '';
    const category = actionId.split(':', 2)[0] === 'build'
      ? actionId.split(':')[1]
      : actionId.split(':')[0];
    categories[category] = (categories[category] ?? 0) + 1;
  }
  return {
    decisions: records.length,
    valid: valid.length,
    invalid: counts((row) => row.status === 'invalid'),
    timeouts: counts((row) => row.status === 'timeout'),
    unavailable: counts((row) => row.status === 'unavailable'),
    errors: counts((row) => row.status === 'error' || row.status === 'unavailable'),
    realInferences: counts((row) => row.source === 'real' && row.provenance?.inference === true),
    fallback: counts((row) => row.fallback),
    agreementRate: valid.length ? valid.filter((row) => row.agreement).length / valid.length : null,
    divergences: valid.filter((row) => !row.agreement).length,
    possibleLoops: counts((row) => row.possibleLoop),
    unproductiveLoops: counts((row) => row.unproductiveLoop),
    actionsByCategory: categories,
    blockedByValidator: counts((row) => row.status === 'invalid'),
    latencyMs: {
      average: sortedLatency.length ? sortedLatency.reduce((a, b) => a + b, 0) / sortedLatency.length : null,
      p50: percentile(0.5),
      p95: percentile(0.95)
    }
  };
}
