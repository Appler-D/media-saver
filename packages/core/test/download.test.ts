import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadImages, downloadVariant } from '../src/download.js';
import type { MediaItem, MediaVariant } from '../src/types.js';

const fileBytes = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': fileBytes.length,
    });
    response.end(fileBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

const baseItem: MediaItem = {
  platform: 'douyin',
  platformName: '抖音',
  platformItemId: '1',
  title: 'test',
  pageUrl: 'https://example.com',
  kind: 'images',
  variants: [],
};

describe('download engine', () => {
  it('downloads every image into a folder', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'media-saver-test-'));
    try {
      const paths = await downloadImages(
        {
          ...baseItem,
          images: [
            { id: 'image-1', url: `${baseUrl}/a.png`, ext: 'png', watermark: 'none' },
            { id: 'image-2', url: `${baseUrl}/b.png`, ext: 'png', watermark: 'none' },
          ],
        },
        { outputDir },
      );
      expect(paths).toHaveLength(2);
      const [first, second] = paths;
      if (!first || !second) throw new Error('missing downloaded files');
      expect((await readFile(first)).equals(fileBytes)).toBe(true);
      expect((await readFile(second)).equals(fileBytes)).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('downloads a single-file variant', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'media-saver-test-'));
    try {
      const variant: MediaVariant = {
        id: 'v1',
        label: '720P',
        kind: 'video',
        quality: '720p',
        watermark: 'none',
        ext: 'mp4',
        url: `${baseUrl}/v.mp4`,
      };
      const path = await downloadVariant(
        { ...baseItem, kind: 'video', variants: [variant] },
        variant,
        { outputDir, filename: 'clip' },
      );
      expect(path.endsWith('clip.mp4')).toBe(true);
      expect((await readFile(path)).equals(fileBytes)).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
