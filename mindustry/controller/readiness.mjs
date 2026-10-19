import {setTimeout as sleep} from 'node:timers/promises';
import {getState} from './state.mjs';

/**
 * M1 preflight ONLY: verify a real, read-only sequence of server snapshots.
 * This never sends build commands or alters the simulation.
 */
export async function validateReadiness({readState = getState, pause = sleep,
  samples = 3, intervalMs = 600} = {}) {
  if (!Number.isSafeInteger(samples) || samples < 2 || samples > 20 ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 10000) {
    throw new TypeError('Invalid readiness sampling parameters');
  }

  let first, previous;
  for (let index = 0; index < samples; index++) {
    if (index) await pause(intervalMs);
    const state = await readState();
    if (!state.ready) throw new Error('Mindustry map is not ready');
    if (!state.playing || state.gameOver || state.won) {
      throw new Error('Mindustry must be an active Survival game');
    }
    if (!state.core || state.core.health <= 0) {
      throw new Error('A living player core is required for M1 preflight');
    }
    if (previous && (state.width !== first.width || state.height !== first.height)) {
      throw new Error('Map changed during readiness sampling');
    }
    if (previous && (state.tick < previous.tick || state.wave < previous.wave)) {
      throw new Error('Simulation time moved backwards');
    }
    if (!first) first = state;
    previous = state;
  }
  if (previous.tick <= first.tick) throw new Error('Simulation tick did not advance');
  return Object.freeze({
    kind: 'mindustry_m1_preflight', schemaVersion: 1, readOnly: true,
    samples, waveStart: first.wave, waveEnd: previous.wave,
    tickStart: first.tick, tickEnd: previous.tick,
    width: first.width, height: first.height,
    // Only readiness evidence; M1 commands or autonomous play are not implemented.
    commandsExecuted: 0, gameplayAutonomous: false
  });
}
