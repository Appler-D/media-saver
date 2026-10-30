import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { MediaItem, MediaVariant, PlatformId } from './types.js';

export const HISTORY_VERSION = 1 as const;
export const HISTORY_LIMIT = 200;
export const HISTORY_MAX_DOWNLOADS = 30;

export interface HistoryDownload {
  variantId: string;
  label: string;
  quality?: string;
  watermark?: 'none' | 'watermarked';
  filename: string;
  path?: string;
  at: string;
}

export interface HistoryEntry {
  id: string;
  platform: PlatformId;
  platformName: string;
  platformItemId: string;
  title: string;
  author?: string;
  pageUrl: string;
  kind: 'video' | 'images';
  imageCount?: number;
  createdAt: string;
  lastDownloadedAt: string;
  downloads: HistoryDownload[];
}

export interface HistoryFile {
  version: typeof HISTORY_VERSION;
  items: HistoryEntry[];
}

export interface RecordDownloadInput {
  item: MediaItem;
  filename: string;
  path?: string;
  variant?: MediaVariant;
  imageId?: string;
  imageLabel?: string;
  imageCount?: number;
  now?: Date;
}

export function defaultHistoryPath(): string {
  const configured = process.env.MEDIA_SAVER_HISTORY_FILE?.trim();
  return configured || join(homedir(), '.media-saver', 'history.json');
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.platform === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.pageUrl === 'string' &&
    (entry.kind === 'video' || entry.kind === 'images') &&
    typeof entry.createdAt === 'string' &&
    typeof entry.lastDownloadedAt === 'string' &&
    Array.isArray(entry.downloads)
  );
}

function isHistoryDownload(value: unknown): value is HistoryDownload {
  if (!value || typeof value !== 'object') return false;
  const download = value as Record<string, unknown>;
  return (
    typeof download.variantId === 'string' &&
    typeof download.label === 'string' &&
    typeof download.filename === 'string' &&
    typeof download.at === 'string'
  );
}

export async function readHistory(filePath = defaultHistoryPath()): Promise<HistoryFile> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HistoryFile>;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return {
      version: HISTORY_VERSION,
      items: items
        .filter(isHistoryEntry)
        .map((entry) => ({
          ...entry,
          downloads: entry.downloads.filter(isHistoryDownload).slice(0, HISTORY_MAX_DOWNLOADS),
        }))
        .sort((a, b) => b.lastDownloadedAt.localeCompare(a.lastDownloadedAt))
        .slice(0, HISTORY_LIMIT),
    };
  } catch {
    return { version: HISTORY_VERSION, items: [] };
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeHistoryFile(filePath: string, history: HistoryFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(tempPath, filePath);
}

function buildDownload(input: RecordDownloadInput, at: string): HistoryDownload {
  if (input.variant) {
    return {
      variantId: input.variant.id,
      label: input.variant.label,
      quality: input.variant.quality,
      watermark: input.variant.watermark,
      filename: input.filename,
      path: input.path,
      at,
    };
  }

  if (input.imageId) {
    return {
      variantId: input.imageId,
      label: input.imageLabel ?? input.imageId,
      filename: input.filename,
      path: input.path,
      at,
    };
  }

  return {
    variantId: 'images',
    label: input.imageCount ? `图集（${input.imageCount} 张）` : '下载',
    filename: input.filename,
    path: input.path,
    at,
  };
}

export function recordDownload(
  input: RecordDownloadInput,
  filePath = defaultHistoryPath(),
): Promise<HistoryEntry> {
  return enqueue(async () => {
    const history = await readHistory(filePath);
    const now = (input.now ?? new Date()).toISOString();
    const item = input.item;
    const key = `${item.platform}:${item.platformItemId}`;
    let entry = history.items.find(
      (candidate) => `${candidate.platform}:${candidate.platformItemId}` === key,
    );

    const download = buildDownload(input, now);
    if (!entry) {
      entry = {
        id: randomUUID(),
        platform: item.platform,
        platformName: item.platformName,
        platformItemId: item.platformItemId,
        title: item.title,
        author: item.author,
        pageUrl: item.pageUrl,
        kind: item.kind,
        imageCount: input.imageCount ?? item.images?.length,
        createdAt: now,
        lastDownloadedAt: now,
        downloads: [download],
      };
      history.items.unshift(entry);
    } else {
      entry.platformName = item.platformName;
      entry.title = item.title;
      entry.author = item.author;
      entry.pageUrl = item.pageUrl;
      entry.kind = item.kind;
      const imageCount = input.imageCount ?? item.images?.length;
      if (imageCount !== undefined) entry.imageCount = imageCount;
      entry.lastDownloadedAt = now;
      entry.downloads = [
        download,
        ...entry.downloads.filter((candidate) => candidate.variantId !== download.variantId),
      ].slice(0, HISTORY_MAX_DOWNLOADS);
    }

    history.items.sort((a, b) => b.lastDownloadedAt.localeCompare(a.lastDownloadedAt));
    history.items = history.items.slice(0, HISTORY_LIMIT);
    await writeHistoryFile(filePath, history);
    return entry;
  });
}

export function removeHistoryEntry(id: string, filePath = defaultHistoryPath()): Promise<void> {
  return enqueue(async () => {
    const history = await readHistory(filePath);
    history.items = history.items.filter((entry) => entry.id !== id);
    await writeHistoryFile(filePath, history);
  });
}

export function clearHistory(filePath = defaultHistoryPath()): Promise<void> {
  return enqueue(async () => {
    await writeHistoryFile(filePath, { version: HISTORY_VERSION, items: [] });
  });
}
