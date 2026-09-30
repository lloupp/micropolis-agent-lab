import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, '.vendor', 'MicropolisCore');
const source = join(root, 'overlay', 'agent');
const target = join(upstream, 'apps', 'micropolis', 'src', 'lib', 'agent');
const viewPath = join(upstream, 'apps', 'micropolis', 'src', 'lib', 'MicropolisView.svelte');

if (!existsSync(viewPath)) {
  throw new Error('MicropolisCore não encontrado. Execute npm run setup primeiro.');
}

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });

let view = await readFile(viewPath, 'utf8');

const importLine = "  import AgentPanel from '$lib/agent/AgentPanel.svelte';";
if (!view.includes(importLine)) {
  const anchor = "  import type { ScreenRect } from '$lib/input/viewportTileFrame';";
  if (!view.includes(anchor)) {
    throw new Error('Anchor de importação não encontrado em MicropolisView.svelte.');
  }
  view = view.replace(anchor, anchor + '\n' + importLine);
}

const legacyPanelLine = '    <AgentPanel simulator={micropolisSimulator} />';
const panelLine = '    <AgentPanel getSimulator={() => micropolisSimulator} />';
if (view.includes(legacyPanelLine)) {
  view = view.replace(legacyPanelLine, panelLine);
}
if (!view.includes(panelLine)) {
  const anchor = '    <MessageOverlay />';
  if (!view.includes(anchor)) {
    throw new Error('Anchor do painel não encontrado em MicropolisView.svelte.');
  }
  view = view.replace(anchor, panelLine + '\n\n' + anchor);
}

await writeFile(viewPath, view);
console.log('Agent Lab aplicado ao MicropolisView.');
