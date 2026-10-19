const DEFAULT_URL = 'http://127.0.0.1:8766/v1/state';

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError('Invalid ' + name);
  }
  return value;
}

export function parseState(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('State must be an object');
  }
  if (data.schemaVersion !== 1 || typeof data.ready !== 'boolean') {
    throw new TypeError('Unsupported schemaVersion or ready');
  }
  if (!data.ready) return Object.freeze({schemaVersion: 1, ready: false});
  for (const field of ['playing', 'gameOver', 'won']) {
    if (typeof data[field] !== 'boolean') throw new TypeError('Invalid ' + field);
  }
  const core = data.core === null ? null : (() => {
    if (!data.core || typeof data.core !== 'object' || Array.isArray(data.core)) {
      throw new TypeError('Invalid core');
    }
    return Object.freeze({
      x: integer(data.core.x, 'core.x'),
      y: integer(data.core.y, 'core.y'),
      health: integer(data.core.health, 'core.health'),
      copper: integer(data.core.copper, 'core.copper'),
      lead: integer(data.core.lead, 'core.lead')
    });
  })();
  const width = integer(data.width, 'width', 1);
  const height = integer(data.height, 'height', 1);
  if (core && (core.x >= width || core.y >= height)) {
    throw new TypeError('Core outside map');
  }
  return Object.freeze({
    schemaVersion: 1, ready: true,
    wave: integer(data.wave, 'wave'),
    tick: integer(data.tick, 'tick'),
    width, height,
    playing: data.playing,
    gameOver: data.gameOver,
    won: data.won,
    core
  });
}

export async function getState({url = DEFAULT_URL, fetchImpl = fetch} = {}) {
  const target = new URL(url);
  // Avoid forwarding gameplay snapshots to remote endpoints inadvertently.
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1'
      || target.username || target.password || target.search || target.hash
      || target.pathname !== '/v1/state') {
    throw new TypeError('Only http://127.0.0.1:<port>/v1/state is allowed');
  }
  const response = await fetchImpl(target, {
    method: 'GET',
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error('Mindustry bridge returned HTTP ' + response.status);
  return parseState(await response.json());
}
