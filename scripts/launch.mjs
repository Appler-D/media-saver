#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'http://127.0.0.1:17890';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pnpmCheck = spawnSync('pnpm', ['-v'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
if (pnpmCheck.status !== 0) {
  console.error('没有找到 pnpm。请先安装 Node.js 20.19+ 与 pnpm：npm i -g pnpm');
  process.exit(1);
}

async function healthy() {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', baseUrl]]
      : process.platform === 'darwin'
        ? ['open', [baseUrl]]
        : ['xdg-open', [baseUrl]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

if (await healthy()) {
  openBrowser();
  process.exit(0);
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('首次运行，安装依赖…');
  const install = spawn('pnpm', ['install'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const code = await new Promise((resolve) => install.on('exit', resolve));
  if (code !== 0) process.exit(code ?? 1);
}

console.log('启动 MediaSaver…');
const server = spawn('pnpm', ['web'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  if (await healthy()) {
    openBrowser();
    break;
  }
  await sleep(700);
}

const shutdown = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => process.exit(code ?? 0));
