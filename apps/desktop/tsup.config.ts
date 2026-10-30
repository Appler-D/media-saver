import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  clean: true,
  sourcemap: true,
  external: [
    'electron',
    'fastify',
    '@fastify/cors',
    '@fastify/static',
    'puppeteer-core',
    '@ffmpeg-installer/ffmpeg',
  ],
  noExternal: ['@media-saver/core', '@media-saver/web'],
  outExtension: () => ({ js: '.cjs' }),
});
