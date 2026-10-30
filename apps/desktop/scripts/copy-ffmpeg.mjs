import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const target = join(root, 'resources', name);

mkdirSync(dirname(target), { recursive: true });
copyFileSync(ffmpeg.path, target);
if (process.platform !== 'win32') chmodSync(target, 0o755);
console.log(`[desktop] ffmpeg -> ${target}`);
