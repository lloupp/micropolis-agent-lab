// M1 local-only write API. Never forward tokens or commands to remote hosts.
const BASE = 'http://127.0.0.1:8766';
const VALID_ID = /^[A-Za-z0-9_-]{1,48}$/;
const BLOCKS = new Set(['conveyor', 'router', 'junction']);
const TERMINAL = new Set(['completed', 'rejected', 'failed', 'canceled']);

function endpoint(url) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' ||
      !/^\d+$/.test(target.port) || target.username || target.password ||
      target.search || target.hash || target.pathname !== '/') {
    throw new TypeError('Only loopback http://127.0.0.1:<port>/ is supported');
  }
  return target.origin;
}
function commandShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !VALID_ID.test(value.id) || !BLOCKS.has(value.block) ||
      !Number.isSafeInteger(value.x) || value.x < 0 || value.x > 999 ||
      !Number.isSafeInteger(value.y) || value.y < 0 || value.y > 999 ||
      !Number.isSafeInteger(value.rotation) || value.rotation < 0 || value.rotation > 3) {
    throw new TypeError('Invalid M1 build command');
  }
  return Object.freeze({id: value.id, block: value.block, x: value.x,
    y: value.y, rotation: value.rotation});
}
function tokenValue(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new TypeError('MINDUSTRY_AGENT_TOKEN must be a 32-128 character base64url secret');
  }
  return token;
}
async function request(url, token, options, fetchImpl) {
  const base = endpoint(url);
  const response = await fetchImpl(base + options.path, {
    method: options.method,
    headers: {
      Authorization: 'Bearer ' + tokenValue(token),
      Accept: 'application/json',
      ...(options.body ? {'Content-Type': 'application/json'} : {})
    },
    ...(options.body ? {body: JSON.stringify(options.body)} : {}),
    signal: AbortSignal.timeout(3000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error('M1 HTTP ' + response.status + ': ' + (data.error ?? 'unknown'));
  return Object.freeze(data);
}
export async function submitBuild(command, {token = process.env.MINDUSTRY_AGENT_TOKEN,
  url = BASE, fetchImpl = fetch} = {}) {
  const body = commandShape(command);
  return request(url, token, {path: '/v1/build', method: 'POST', body}, fetchImpl);
}
export async function getBuild(id, {token = process.env.MINDUSTRY_AGENT_TOKEN,
  url = BASE, fetchImpl = fetch} = {}) {
  if (typeof id !== 'string' || !VALID_ID.test(id)) throw new TypeError('Invalid command ID');
  return request(url, token, {path: '/v1/commands/' + id, method: 'GET'}, fetchImpl);
}
export async function waitForBuild(id, {token = process.env.MINDUSTRY_AGENT_TOKEN,
  url = BASE, fetchImpl = fetch, intervalMs = 500, maxAttempts = 120,
  pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) {
    throw new TypeError('Invalid polling bounds');
  }
  for (let n = 0; n < maxAttempts; n++) {
    const status = await getBuild(id, {token, url, fetchImpl});
    if (TERMINAL.has(status.status)) return status;
    if (n < maxAttempts - 1) await pause(intervalMs);
  }
  throw new Error('Build still pending after polling limit: ' + id);
}
