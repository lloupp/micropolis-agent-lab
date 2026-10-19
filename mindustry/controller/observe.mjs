import {setTimeout as sleep} from 'node:timers/promises';
import {getState} from './state.mjs';

const once = process.argv.includes('--once');
const interval = 1000; // one passive observation per second; not game ticks

async function run() {
  while (true) {
    try {
      const state = await getState({url: process.env.MINDUSTRY_AGENT_URL});
      process.stdout.write(JSON.stringify({
        kind: 'passive_observation',
        capturedAt: new Date().toISOString(),
        state
      }) + '\n');
    } catch (error) {
      console.error('[AgentLab] ' + error.message);
      if (once) process.exitCode = 1;
    }
    if (once) break;
    await sleep(interval);
  }
}

run().catch(error => {
  console.error('[AgentLab] fatal: ' + error.message);
  process.exitCode = 1;
});
