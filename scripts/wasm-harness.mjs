import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lib = resolve(root, '.vendor/MicropolisCore/apps/micropolis/src/lib');
export async function loadTs(file, replacements = {}) {
  let source = readFileSync(file, 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replace(from, to);
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
}
export async function createHarness() {
  const { loadMicropolisMainModule } = await import(pathToFileURL(resolve(lib, 'wasm/node.ts')));
  const { createNoopJsCallback } = await import(pathToFileURL(resolve(lib, 'wasm/callbacks.ts')));
  const views = await loadTs(resolve(lib, 'wasm/views.ts'), {
    "'./heap'": JSON.stringify(pathToFileURL(resolve(lib, 'wasm/heap.ts')).href)
  });
  const viewsUrl = 'data:text/javascript;base64,' + Buffer.from(
    stripTypeScriptTypes(readFileSync(resolve(lib, 'wasm/views.ts'), 'utf8').replace(
      "'./heap'", JSON.stringify(pathToFileURL(resolve(lib, 'wasm/heap.ts')).href)
    ))).toString('base64');
  const { MicropolisSimulator } = await loadTs(resolve(lib, 'MicropolisSimulator.ts'), {
    "'$lib/wasm/browser'": JSON.stringify(pathToFileURL(resolve(lib, 'wasm/browser.ts')).href),
    "'$lib/wasm/views'": JSON.stringify(viewsUrl)
  });
  // Only Svelte's UI synchronization is omitted. Reset, snapshots, tools,
  // simulator tick/pause methods and WASM all run their production code.
  const runtime = await loadTs(resolve(root, 'overlay/agent/runtime.ts'), {
    "import { micropolisReactive } from '$lib/MicropolisReactive.svelte';":
      'const micropolisReactive = { syncFromEngine() {} };',
    "'$lib/gameTools'": JSON.stringify(pathToFileURL(resolve(lib, 'gameTools.ts')).href)
  });
  const engine = await loadMicropolisMainModule();
  const simulator = new MicropolisSimulator();
  simulator.micropolisengine = engine;
  simulator.micropolis = new engine.Micropolis();
  simulator.callback = createNoopJsCallback(engine);
  simulator.micropolis.setCallback(simulator.callback, {});
  simulator.micropolis.init();
  simulator.syncMapViews();
  return { simulator, runtime, engine, views };
}
