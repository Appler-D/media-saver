import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHistory,
  HISTORY_LIMIT,
  readHistory,
  recordDownload,
  removeHistoryEntry,
} from '../src/history.js';
import type { HistoryEntry, MediaItem, MediaVariant } from '../src/index.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true });
  }
  directories.length = 0;
});

async function historyFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'media-saver-history-'));
  directories.push(directory);
  return join(directory, 'history.json');
}

function makeItem(id: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    platform: 'douyin',
    platformName: '抖音',
    platformItemId: id,
    title: `视频 ${id}`,
    pageUrl: `https://www.douyin.com/video/${id}`,
    kind: 'video',
    variants: [],
    ...overrides,
  };
}

function makeVariant(id: string): MediaVariant {
  return {
    id,
    label: `${id} 清晰度`,
    kind: 'video',
    quality: id,
    watermark: 'none',
    ext: 'mp4',
  };
}

describe('download history', () => {
  it('records a download and upserts the same item', async () => {
    const file = await historyFile();
    await recordDownload(
      {
        item: makeItem('1'),
        filename: 'a.mp4',
        path: 'C:/downloads/a.mp4',
        variant: makeVariant('1080p'),
        now: new Date('2026-01-01T00:00:00Z'),
      },
      file,
    );
    await recordDownload(
      {
        item: { ...makeItem('1'), title: '更新后的标题' },
        filename: 'b.mp4',
        variant: makeVariant('720p'),
        now: new Date('2026-01-02T00:00:00Z'),
      },
      file,
    );

    const history = await readHistory(file);
    expect(history.items).toHaveLength(1);
    const [entry] = history.items;
    expect(entry?.title).toBe('更新后的标题');
    expect(entry?.lastDownloadedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(entry?.downloads.map((download) => download.variantId).sort()).toEqual([
      '1080p',
      '720p',
    ]);
    expect(entry?.downloads.find((download) => download.variantId === '1080p')?.path).toBe(
      'C:/downloads/a.mp4',
    );
  });

  it('records image downloads with an image count', async () => {
    const file = await historyFile();
    const item = makeItem('2', {
      kind: 'images',
      images: [
        { id: 'image-1', url: 'https://example.com/1.webp', ext: 'webp', watermark: 'none' },
        { id: 'image-2', url: 'https://example.com/2.webp', ext: 'webp', watermark: 'none' },
      ],
    });

    const entry = await recordDownload(
      {
        item,
        filename: '01.webp',
        imageId: 'image-1',
        imageLabel: '图片 1',
        imageCount: 2,
      },
      file,
    );

    expect(entry.kind).toBe('images');
    expect(entry.imageCount).toBe(2);
    expect(entry.downloads[0]?.variantId).toBe('image-1');
    expect(entry.downloads[0]?.label).toBe('图片 1');
  });

  it('removes a single entry and clears all history', async () => {
    const file = await historyFile();
    await recordDownload(
      { item: makeItem('3'), filename: 'c.mp4', variant: makeVariant('720p') },
      file,
    );
    const before = await readHistory(file);
    const id = before.items[0]?.id;
    expect(id).toBeTruthy();
    await removeHistoryEntry(id as string, file);
    expect((await readHistory(file)).items).toHaveLength(0);

    await recordDownload(
      { item: makeItem('4'), filename: 'd.mp4', variant: makeVariant('720p') },
      file,
    );
    await clearHistory(file);
    expect((await readHistory(file)).items).toHaveLength(0);
  });

  it('caps the file at the history limit and writes readable JSON', async () => {
    const file = await historyFile();
    const base = Date.parse('2026-01-01T00:00:00Z');
    const items: HistoryEntry[] = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => ({
      id: `id-${index}`,
      platform: 'douyin',
      platformName: '抖音',
      platformItemId: `${index}`,
      title: `视频 ${index}`,
      pageUrl: `https://example.com/${index}`,
      kind: 'video',
      createdAt: new Date(base - index * 1000).toISOString(),
      lastDownloadedAt: new Date(base - index * 1000).toISOString(),
      downloads: [],
    }));
    await writeFile(file, JSON.stringify({ version: 1, items }), 'utf8');

    const history = await readHistory(file);
    expect(history.items).toHaveLength(HISTORY_LIMIT);
    expect(history.items[0]?.platformItemId).toBe('0');
    expect(await readFile(file, 'utf8')).toContain('"version":1');
  });

  it('treats a corrupt file as empty history', async () => {
    const file = await historyFile();
    await writeFile(file, '{ not valid json', 'utf8');
    expect((await readHistory(file)).items).toEqual([]);
  });
});
