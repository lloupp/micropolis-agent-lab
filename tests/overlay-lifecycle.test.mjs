import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AgentPanel resolve o simulador por getter e ativa quando o engine fica pronto', async () => {
  const source = await readFile(new URL('../overlay/agent/AgentPanel.svelte', import.meta.url), 'utf8');

  assert.match(source, /export let getSimulator:/);
  assert.match(source, /function currentSimulator\(\)/);
  assert.match(source, /onMount\(\(\) =>/);
  assert.match(source, /ready = !!simulator\?\.micropolis/);
  assert.doesNotMatch(source, /export let simulator:/);
});

test('overlay migra a injeção antiga sem duplicar AgentPanel', async () => {
  const source = await readFile(new URL('../scripts/apply-overlay.mjs', import.meta.url), 'utf8');

  assert.match(source, /legacyPanelLine/);
  assert.match(source, /getSimulator=\{\(\) => micropolisSimulator\}/);
  assert.match(source, /view\.replace\(legacyPanelLine, panelLine\)/);
});


test('servidor visual usa WASM versionado sem iniciar recompilação do motor', async () => {
  const source = await readFile(new URL('../scripts/dev.mjs', import.meta.url), 'utf8');

  assert.match(source, /dev:vite/);
  assert.doesNotMatch(source, /'micropolis', 'dev'/);
  assert.match(source, /VITE_PORT/);
});
