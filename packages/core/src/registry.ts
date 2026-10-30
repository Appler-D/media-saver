import { ResolveError } from './errors.js';
import { bilibiliAdapter } from './platforms/bilibili.js';
import { douyinAdapter } from './platforms/douyin.js';
import { xiaohongshuAdapter } from './platforms/xiaohongshu.js';
import type { MediaItem, PlatformAdapter, ResolveContext } from './types.js';
import { parseUrl } from './util/url.js';

const adapters: PlatformAdapter[] = [douyinAdapter, bilibiliAdapter, xiaohongshuAdapter];

export function listAdapters(): readonly PlatformAdapter[] {
  return adapters;
}

export function findAdapter(input: string | URL): PlatformAdapter | undefined {
  const url = typeof input === 'string' ? parseUrl(input) : input;
  if (!url) return undefined;
  return adapters.find((adapter) => adapter.match(url));
}

export async function resolveMedia(
  input: string,
  context: ResolveContext = {},
): Promise<MediaItem> {
  const url = parseUrl(input);
  if (!url) {
    throw new ResolveError('unsupported_url', '没有找到有效的链接');
  }

  const adapter = adapters.find((candidate) => candidate.match(url));
  if (!adapter) {
    throw new ResolveError('unsupported_url', '暂不支持这个平台的链接');
  }

  return adapter.resolve(url, context);
}
