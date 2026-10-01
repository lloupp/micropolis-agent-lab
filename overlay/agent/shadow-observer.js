import { decide, isRealJuliaProvenance } from './julia-client.js';
import { createJuliaMemory, advanceJuliaMemory, createShadowRecord, validateJuliaDecision } from './agents.js';

/** No engine reference is accepted. Inference operates only on copied decision data.
 * @param {{decider?: typeof decide, source?: 'real'|'mock', onRecord?: (records: Array<ReturnType<typeof createShadowRecord>>) => void}} [options]
 */
export function createShadowObserver({ decider = decide, source = 'real', onRecord = () => {} } = {}) {
  /** @type {Array<ReturnType<typeof createShadowRecord>>} */
  const records = [];
  let memory = createJuliaMemory();
  let pending = Promise.resolve();
  let canceled = false;

  /** @param {{decision: number, snapshot: import('./agents.js').ModelSnapshot, candidates: import('./agents.js').Candidate[], rulesDecision: {actionId: string|null}, rulesResult: import('./runtime').ExecutionResult, preparationError?: string|null}} data */
  function enqueue(data) {
    // Capture the historical state before any later Rules step can change it.
    let captured;
    try { captured = structuredClone(data); }
    catch { captured = { ...data, candidates: [], preparationError: 'snapshot_serialization_error' }; }
    const request = captured;
    pending = pending.then(async () => {
      if (canceled) return;
      /** @type {import('./julia-client.js').JuliaReply} */
      let reply;
      try {
        reply = request.preparationError
          ? { status: 'invalid', reason: request.preparationError, latencyMs: 0 }
          : await decider(request.snapshot, request.candidates, memory);
      } catch {
        reply = { status: 'error', reason: 'decider_exception', latencyMs: 0 };
      }
      if (canceled) return;
      const validation = reply.status === 'response'
        ? source === 'real' && !isRealJuliaProvenance(reply.provenance)
          ? { status: /** @type {'invalid'} */ ('invalid'), reason: 'unverified_model', candidate: null }
          : validateJuliaDecision(reply.output, request.candidates)
        : { status: reply.status, reason: reply.reason ?? reply.status, candidate: null };
      const row = createShadowRecord({ ...request, validation,
        rawDecision: /** @type {{confidence?: number}|null} */ (reply.output ?? null),
        latencyMs: reply.latencyMs, previousRecords: records, source,
        provenance: reply.provenance, endpoint: reply.endpoint });
      records.push(row);
      memory = advanceJuliaMemory(memory, row.juliaActionId);
      try { onRecord([...records]); } catch { /* UI observers cannot affect Rules. */ }
    });
  }
  return { enqueue, drain: () => pending, records: () => [...records], cancel: () => { canceled = true; } };
}
