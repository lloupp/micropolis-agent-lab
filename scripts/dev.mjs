import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = join(root, '.vendor', 'MicropolisCore');

if (!existsSync(join(upstream, 'apps', 'micropolis'))) {
  console.error('MicropolisCore ainda não foi preparado. Execute npm run setup.');
  process.exit(1);
}

const overlay = spawnSync(process.execPath, [join(root, 'scripts/apply-overlay.mjs')], {
  cwd: root,
  stdio: 'inherit'
});
if (overlay.status !== 0) process.exit(overlay.status ?? 1);

const port = process.env.VITE_PORT ?? '5177';
console.log(`Abrindo Micropolis Agent Lab em http://127.0.0.1:${port}`);

const child = spawn(
  'corepack',
  ['pnpm', '--filter', 'micropolis', 'dev:vite', '--', '--host', '127.0.0.1'],
  {
    cwd: upstream,
    stdio: 'inherit',
    shell: false,
    env: process.env
  }
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
