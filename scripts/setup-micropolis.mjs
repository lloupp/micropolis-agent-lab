import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'config/upstream.json'), 'utf8'));
const vendorRoot = join(root, '.vendor');
const micropolis = join(vendorRoot, 'MicropolisCore');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: false,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' falhou com código ' + result.status);
  }
}

await mkdir(vendorRoot, { recursive: true });

if (!existsSync(join(micropolis, '.git'))) {
  console.log('Baixando MicropolisCore...');
  run('git', ['init', micropolis]);
  run('git', ['remote', 'add', 'origin', config.repository], { cwd: micropolis });
}

console.log('Fixando upstream em ' + config.commit + '...');
run('git', ['fetch', '--depth', '1', 'origin', config.commit], { cwd: micropolis });
run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: micropolis });

console.log('Instalando dependências do MicropolisCore...');
run('corepack', ['pnpm', 'install', '--frozen-lockfile'], { cwd: micropolis });

console.log('Aplicando Agent Lab...');
run(process.execPath, [join(root, 'scripts/apply-overlay.mjs')]);

console.log('');
console.log('Setup concluído.');
console.log('Execute: npm run dev');
