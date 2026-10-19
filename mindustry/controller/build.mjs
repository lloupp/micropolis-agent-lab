import {randomUUID} from 'node:crypto';
import {submitBuild, waitForBuild} from './commands.mjs';
import {getState} from './state.mjs';

// Explicit operator action. This script is not an autonomous agent loop.
const args = process.argv.slice(2);
if (!args.includes('--execute')) {
  console.error('Dry-run only. To submit a real order, pass --execute and set MINDUSTRY_AGENT_TOKEN.');
  console.error('Usage: node mindustry/controller/build.mjs conveyor X Y [ROTATION] --execute');
  process.exitCode = 2;
} else {
  const inputs = args.filter(value => value !== '--execute');
  const [block, xValue, yValue, rotationValue = '0'] = inputs;
  const x = Number(xValue), y = Number(yValue), rotation = Number(rotationValue);
  try {
    const state = await getState();
    if (!state.ready || !state.playing || state.gameOver || !state.core) {
      throw new Error('No active Mindustry map/core on the local bridge');
    }
    const id = 'operator-' + randomUUID();
    const command = {id, block, x, y, rotation};
    console.log('Submitting explicit M1 build: ' + JSON.stringify(command));
    const queued = await submitBuild(command);
    const result = await waitForBuild(id);
    console.log(JSON.stringify({queued:queued.status, result}, null, 2));
    if (result.status !== 'completed') process.exitCode = 1;
  } catch (error) {
    console.error('M1: ' + error.message);
    process.exitCode = 1;
  }
}
