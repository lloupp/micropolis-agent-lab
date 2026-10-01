import model from './julia-model.json' with { type: 'json' };

/** @typedef {{status: 'response'|'invalid'|'error'|'timeout'|'unavailable', output?: unknown, provenance?: Record<string, any>, latencyMs: number, reason?: string, endpoint?: string}} JuliaReply */

/** @param {any} provenance */
export function isRealJuliaProvenance(provenance) {
  return !!provenance && provenance.modelId === model.modelId &&
    provenance.revision === model.revision && provenance.weightsSha256 === model.weightsSha256 &&
    provenance.provider === model.provider && provenance.inference === true &&
    Number.isInteger(provenance.requestId) && provenance.requestId > 0 &&
    typeof provenance.instanceId === 'string' && provenance.instanceId.length > 0;
}

/** Julia can only return a candidate ID. It has no executor or engine reference.
 * @param {import('./runtime').AgentSnapshot & {lastActions?: Array<{actionId: string|null, result: string}>, lastActionResult?: string|null, recentFailures?: string[]}} snapshot
 * @param {Array<{id: string, action: import('./runtime').AgentAction}>} availableActions
 * @param {unknown} memory
 * @param {{endpoint?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<JuliaReply>}
 */
export async function decide(snapshot, availableActions, memory, {
  endpoint = /** @type {any} */ (globalThis).__JULIA_SHADOW_URL__ ?? 'http://127.0.0.1:8765/decide',
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return { status: 'unavailable', reason: 'service_not_configured', latencyMs: 0 };
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  /** @param {JuliaReply['status']} status @param {string} reason @returns {JuliaReply} */
  const failure = (status, reason) => ({ status, reason, endpoint, latencyMs: performance.now() - started });
  try {
    const body = JSON.stringify({ snapshot, availableActions, memory });
    if (new TextEncoder().encode(body).length > model.maxRequestBytes) return failure('invalid', 'context_excessive');
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body
    });
    if (!response.ok) {
      const status = response.status === 408 ? 'timeout'
        : [400, 413, 422].includes(response.status) ? 'invalid'
          : response.status === 503 ? 'unavailable' : 'error';
      return failure(status, `http_${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) return failure('invalid', 'empty_response');
    if (text.length > 65536) return failure('invalid', 'response_too_large');
    let envelope;
    try { envelope = JSON.parse(text); }
    catch { return failure('invalid', 'malformed_json'); }
    if (!isRealJuliaProvenance(envelope?.provenance)) return failure('invalid', 'unverified_model');
    if (!envelope.decision || typeof envelope.decision !== 'object' || Array.isArray(envelope.decision)) {
      return failure('invalid', 'empty_decision');
    }
    return { status: 'response', output: envelope.decision, provenance: envelope.provenance,
      endpoint, latencyMs: performance.now() - started };
  } catch (error) {
    return failure(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unavailable',
      error instanceof Error && error.name === 'AbortError' ? 'request_timeout' : 'connection_error');
  } finally {
    clearTimeout(timeout);
  }
}
