/** Julia-1 protocol client. The response can select IDs only; it cannot issue tools. */
/** @param {import('./runtime').AgentSnapshot & {lastActions?: Array<{actionId: string|null, result: string}>, lastActionResult?: string|null, recentFailures?: string[]}} snapshot
 * @param {Array<{id: string, action: import('./runtime').AgentAction}>} availableActions
 * @param {unknown} memory
 * @param {{endpoint?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{status: 'response', output: unknown, latencyMs: number}|{status: 'timeout'|'unavailable', latencyMs: number}>}
 */
export async function decide(snapshot, availableActions, memory, {
  endpoint = /** @type {any} */ (globalThis).__JULIA_SHADOW_URL__ ?? 'http://127.0.0.1:8765/decide',
  timeoutMs = 1200,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return { status: 'unavailable', latencyMs: 0 };
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: 'Julia-1', snapshot, availableActions, memory })
    });
    if (!response.ok) return { status: 'unavailable', latencyMs: performance.now() - started };
    return { status: 'response', output: await response.json(), latencyMs: performance.now() - started };
  } catch (error) {
    return { status: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unavailable', latencyMs: performance.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}
