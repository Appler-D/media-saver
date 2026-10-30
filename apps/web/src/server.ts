import { fileURLToPath } from 'node:url';
import { startMediaServer } from './app.js';

try {
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  const server = await startMediaServer({ publicDir });
  console.log(`MediaSaver 已启动：${server.url}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`启动失败：${message}`);
  process.exit(1);
}
