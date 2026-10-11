import { decide, isRealJuliaProvenance } from './julia-client.js';
import { createJuliaMemory, advanceJuliaMemory, createShadowRecord, validateJuliaDecision } from './agents.js';

/** @typedef {ReturnType<typeof createShadowRecord>} ShadowRecord */
/** @typedef {{decision: number, snapshot: import('./agents.js').ModelSnapshot, candidates: import('./agents.js').Candidate[], rulesDecision: {actionId: string|null}, rulesResult: import('./runtime').ExecutionResult, preparationError?: string|null}} ShadowRequest */
/** @typedef {{maxPending: number, maxRecords: number, submitted: number, accepted: number, completed: number, pending: number, queued: number, active: boolean, retained: number, dropped: number, lastDroppedDecision: number|null, evicted: number, canceledRequests: number, canceled: boolean}} ShadowStats */

/** No engine reference is accepted. Pending includes the active inference.
 * Defaults preserve the complete 100-decision benchmark; smaller UI limits are explicit.
 * @param {{decider?: typeof decide, source?: 'real'|'mock', maxPending?: number, maxRecords?: number, onRecord?: (records: ShadowRecord[]) => void, onState?: (stats: ShadowStats) => void, onDrop?: (event: {decision: number, reason: 'queue_full'}) => void}} [options]
 */
export function createShadowObserver({ decider = decide, source = 'real', maxPending = 128, maxRecords = 512,
  onRecord = () => {}, onState = () => {}, onDrop = () => {} } = {}) {
  for (const limit of [maxPending, maxRecords]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Shadow limits must be positive safe integers');
  }
  /** @type {ShadowRecord[]} */
  const records = [];
  /** @type {ShadowRequest[]} */
  const queue = [];
  let memory = createJuliaMemory();
  let pending = Promise.resolve();
  let processing = false;
  let active = false;
  let canceled = false;
  let submitted = 0, accepted = 0, completed = 0, dropped = 0, evicted = 0, canceledRequests = 0;
  /** @type {number|null} */
  let lastDroppedDecision = null;
  const controller = new AbortController();

  /** @returns {ShadowStats} */
  function stats() {
    return { maxPending, maxRecords, submitted, accepted, completed,
      pending: queue.length + Number(active), queued: queue.length, active,
      retained: records.length, dropped, lastDroppedDecision, evicted, canceledRequests, canceled };
  }
  function notifyState() {
    try { onState(stats()); } catch { /* UI observers cannot affect Rules. */ }
  }
  // Returned data cannot mutate retained evidence or loop detection.
  const readRecords = () => structuredClone(records);

  async function processQueue() {
    try {
      while (!canceled && queue.length) {
        const request = queue.shift();
        if (!request) break;
        active = true;
        notifyState();
        if (canceled) break;
        /** @type {import('./julia-client.js').JuliaReply} */
        let reply;
        try {
          reply = request.preparationError
            ? { status: 'invalid', reason: request.preparationError, latencyMs: 0 }
            : await decider(request.snapshot, request.candidates, memory, { signal: controller.signal });
        } catch {
          reply = { status: 'error', reason: 'decider_exception', latencyMs: 0 };
        }
        if (canceled) break;
        if (!reply || typeof reply !== 'object' ||
            !['response', 'invalid', 'error', 'timeout', 'unavailable'].includes(reply.status) ||
            !Number.isFinite(reply.latencyMs) || reply.latencyMs < 0) {
          reply = { status: 'error', reason: 'invalid_decider_reply', latencyMs: 0 };
        }
        const validation = reply.status === 'response'
          ? source === 'real' && !isRealJuliaProvenance(reply.provenance)
            ? { status: /** @type {'invalid'} */ ('invalid'), reason: 'unverified_model', candidate: null }
            : validateJuliaDecision(reply.output, request.candidates)
          : { status: reply.status, reason: reply.reason ?? reply.status, candidate: null };
        const row = createShadowRecord({ ...request, validation,
          rawDecision: /** @type {{confidence?: number}|null} */ (reply.output ?? null),
          latencyMs: reply.latencyMs, previousRecords: records, source,
          provenance: reply.provenance, endpoint: reply.endpoint });
        // Keep the original consecutive-streak semantics even when old rows are evicted.
        const previous = records.at(-1);
        if (row.juliaActionId && row.juliaActionId !== 'wait' && previous?.juliaActionId === row.juliaActionId) {
          row.repeatCount = previous.repeatCount + 1;
          row.possibleLoop = row.repeatCount >= 3;
          row.unproductiveLoop = row.possibleLoop && request.rulesDecision.actionId === row.juliaActionId && request.rulesResult.ok === false;
        }
        records.push(row);
        if (records.length > maxRecords) { records.shift(); evicted++; }
        completed++;
        active = false;
        memory = advanceJuliaMemory(memory, row.juliaActionId);
        try { onRecord(readRecords()); } catch { /* UI observers cannot affect Rules. */ }
        notifyState();
      }
    } finally {
      active = false;
      processing = false;
      notifyState();
    }
  }

  /** Capture historical data only after admission; overflow never waits for Julia.
   * @param {ShadowRequest} data @returns {boolean} Whether the request was accepted.
   */
  function enqueue(data) {
    if (canceled) return false;
    submitted++;
    if (queue.length + Number(active) >= maxPending) {
      dropped++;
      lastDroppedDecision = data.decision;
      try { onDrop({ decision: data.decision, reason: 'queue_full' }); } catch { /* Optional external loss log. */ }
      notifyState();
      return false;
    }
    let captured;
    try { captured = structuredClone(data); }
    catch { captured = { ...data, candidates: [], preparationError: 'snapshot_serialization_error' }; }
    queue.push(captured);
    accepted++;
    if (!processing) {
      processing = true;
      pending = Promise.resolve().then(processQueue);
    }
    notifyState();
    return true;
  }
  return { enqueue, stats, records: readRecords,
    drain: async () => { while (processing) await pending; },
    cancel: () => {
      if (canceled) return;
      canceled = true;
      canceledRequests += queue.length + Number(active);
      queue.length = 0;
      active = false;
      controller.abort();
      notifyState();
    }
  };
}
