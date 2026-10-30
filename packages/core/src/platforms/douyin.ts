import { captureDouyinDetail } from '../browser.js';
import { ResolveError } from '../errors.js';
import { DEFAULT_USER_AGENT, fetchText, followRedirect } from '../http.js';
import type {
  MediaImage,
  MediaItem,
  MediaVariant,
  PlatformAdapter,
  ResolveContext,
} from '../types.js';
import { extensionFromUrl } from '../util/filename.js';
import { extractEncodedJson, extractJsonAfter } from '../util/json.js';
import type { DouyinBitRate, DouyinImage, DouyinItem, DouyinUrlList } from './douyin-types.js';

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DOUYIN_HEADERS = {
  referer: 'https://www.douyin.com/',
  'user-agent': DEFAULT_USER_AGENT,
};

interface VideoCandidate {
  entry: DouyinBitRate;
  urls: string[];
  height: number;
  h265: boolean;
  index: number;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function urlsOf(list: DouyinUrlList | undefined): string[] {
  return (list?.url_list ?? []).filter(isHttpUrl);
}

function unwatermark(url: string): string {
  return url.replace(/playwm/g, 'play').replace(/^http:\/\//, 'https://');
}

function toHttps(url: string): string {
  return url.replace(/^http:\/\//, 'https://');
}

function extractAwemeId(url: URL): string | undefined {
  const queryId =
    url.searchParams.get('modal_id') ??
    url.searchParams.get('aweme_id') ??
    url.searchParams.get('item_id');
  if (queryId && /^\d{15,25}$/.test(queryId)) return queryId;

  const match = url.pathname.match(/\/(?:video|note|slides)\/(\d{15,25})/);
  return match?.[1];
}

function findAwemeItem(node: unknown, depth = 0): DouyinItem | undefined {
  if (depth > 15 || node === null || node === undefined) return undefined;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findAwemeItem(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;

  if (
    typeof record.aweme_id === 'string' &&
    (typeof record.video === 'object' || Array.isArray(record.images))
  ) {
    return record as unknown as DouyinItem;
  }

  for (const key of ['item_list', 'note_list', 'items', 'aweme_list']) {
    const list = record[key];
    if (Array.isArray(list)) {
      const found = findAwemeItem(list, depth + 1);
      if (found) return found;
    }
  }

  for (const value of Object.values(record)) {
    const found = findAwemeItem(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function parseSharePage(html: string): DouyinItem | undefined {
  const routerData = extractJsonAfter(html, 'window._ROUTER_DATA');
  if (routerData) {
    const item = findAwemeItem(routerData);
    if (item) return item;
  }

  const renderData = extractEncodedJson(
    html,
    /<script[^>]+id="RENDER_DATA"[^>]*>([^<]+)<\/script>/i,
  );
  if (renderData) {
    const item = findAwemeItem(renderData);
    if (item) return item;
  }

  const initialState = extractJsonAfter(html, 'window.__INITIAL_STATE__');
  if (initialState) {
    const item = findAwemeItem(initialState);
    if (item) return item;
  }

  return undefined;
}

function gearHeight(entry: DouyinBitRate): number {
  const name = entry.gear_name ?? '';
  const fromName = name.match(/(?:^|_)(\d{3,4})(?:_|$)/)?.[1] ?? name.match(/(\d{3,4})p/i)?.[1];
  if (fromName) return Number(fromName);
  if (typeof entry.height === 'number' && entry.height > 0) return entry.height;
  const fromUrl = entry.play_addr?.url_list?.find(isHttpUrl)?.match(/ratio=(\d{3,4})p/i)?.[1];
  return fromUrl ? Number(fromUrl) : 0;
}

function qualityLabel(height: number): string {
  if (height >= 2160) return '4K 超清';
  if (height >= 1440) return '2K 超清';
  if (height >= 1080) return '1080P 高清';
  if (height >= 720) return '720P 高清';
  if (height >= 540) return '540P 标清';
  if (height >= 480) return '480P 标清';
  return height > 0 ? `${height}P` : '原画';
}

function preferCandidate(a: VideoCandidate, b: VideoCandidate): boolean {
  const codecA = a.h265 ? 1 : 0;
  const codecB = b.h265 ? 1 : 0;
  if (codecA !== codecB) return codecA < codecB;
  return (a.entry.bit_rate ?? 0) > (b.entry.bit_rate ?? 0);
}

function buildVideoVariants(item: DouyinItem): MediaVariant[] {
  const variants: MediaVariant[] = [];
  const candidates = (item.video?.bit_rate ?? [])
    .map((entry, index): VideoCandidate => {
      const urls = Array.from(new Set(urlsOf(entry.play_addr).map(unwatermark)));
      return { entry, urls, height: gearHeight(entry), h265: entry.is_h265 === 1, index };
    })
    .filter((candidate) => candidate.urls.length > 0);

  const preferred = new Map<string, VideoCandidate>();
  for (const candidate of candidates) {
    const key = candidate.height > 0 ? String(candidate.height) : `unknown-${candidate.index}`;
    const existing = preferred.get(key);
    if (!existing || preferCandidate(candidate, existing)) preferred.set(key, candidate);
  }

  const ordered = [...preferred.values()].sort((a, b) => {
    if (a.height !== b.height) return b.height - a.height;
    return (b.entry.bit_rate ?? 0) - (a.entry.bit_rate ?? 0);
  });

  for (const candidate of ordered) {
    const [url, ...backups] = candidate.urls;
    if (!url) continue;
    const quality = candidate.height > 0 ? `${candidate.height}p` : 'source';
    variants.push({
      id:
        candidate.height > 0
          ? `douyin-${quality}${candidate.h265 ? '-h265' : ''}`
          : `douyin-source-${candidate.index}`,
      label: `${qualityLabel(candidate.height)}${candidate.h265 ? ' · H.265' : ''}`,
      kind: 'video',
      quality,
      watermark: 'none',
      ext: 'mp4',
      url,
      backupUrls: backups,
      headers: DOUYIN_HEADERS,
    });
  }

  if (variants.length === 0) {
    const playUrls = Array.from(new Set(urlsOf(item.video?.play_addr).map(unwatermark)));
    const [url, ...backups] = playUrls;
    if (url) {
      const ratio = url.match(/ratio=(\d{3,4})p/i)?.[1];
      const height = ratio ? Number(ratio) : 0;
      const quality = height > 0 ? `${height}p` : 'source';
      variants.push({
        id: `douyin-${quality}-h264`,
        label: `${qualityLabel(height)} · 无水印`,
        kind: 'video',
        quality,
        watermark: 'none',
        ext: 'mp4',
        url,
        backupUrls: backups,
        headers: DOUYIN_HEADERS,
      });
    }
  }

  return variants;
}

function pickImageUrl(image: DouyinImage): string | undefined {
  const candidates = [...(image.url_list ?? []), ...(image.download_url_list ?? [])].filter(
    isHttpUrl,
  );
  const jpeg = candidates.find((url) => /\.(jpe?g)(\?|$)/i.test(url));
  return jpeg ?? candidates[0];
}

function buildImages(item: DouyinItem): MediaImage[] {
  return (item.images ?? [])
    .map((image, index): MediaImage | undefined => {
      const url = pickImageUrl(image);
      if (!url) return undefined;
      return {
        id: `image-${index + 1}`,
        url: toHttps(url),
        ext: extensionFromUrl(url, 'jpeg'),
        label: `图片 ${index + 1}`,
        watermark: 'none',
        headers: DOUYIN_HEADERS,
        width: image.width,
        height: image.height,
      } satisfies MediaImage;
    })
    .filter((image): image is MediaImage => image !== undefined);
}

async function fetchShareItem(id: string, context: ResolveContext): Promise<DouyinItem> {
  const candidates = [
    `https://www.iesdouyin.com/share/video/${id}/`,
    `https://www.iesdouyin.com/share/note/${id}/`,
  ];
  let sawChallenge = false;

  for (const url of candidates) {
    const html = await fetchText(url, {
      headers: {
        'user-agent': MOBILE_USER_AGENT,
        referer: 'https://www.douyin.com/',
      },
      cookie: context.cookie,
      timeoutMs: context.timeoutMs,
    });

    if (/验证码|captcha|secsdk|verify-container/i.test(html)) {
      sawChallenge = true;
    }

    const item = parseSharePage(html);
    if (item) return item;
  }

  if (sawChallenge) {
    throw new ResolveError('blocked', '抖音触发了安全验证');
  }
  throw new ResolveError('parse_failed', '抖音分享页没有返回作品数据');
}

async function loadDouyinItem(
  id: string,
  kind: 'video' | 'note',
  context: ResolveContext,
): Promise<DouyinItem> {
  let browserError: unknown;

  try {
    return await captureDouyinDetail(id, {
      kind,
      timeoutMs: context.timeoutMs,
      log: context.log,
    });
  } catch (error) {
    browserError = error;
    context.log?.('抖音：浏览器解析失败，尝试分享页');
  }

  try {
    return await fetchShareItem(id, context);
  } catch (error) {
    if (browserError instanceof ResolveError) {
      const shareMessage = error instanceof Error ? error.message : String(error);
      throw new ResolveError(
        browserError.code,
        `${browserError.message}；分享页解析也失败：${shareMessage}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function resolveDouyin(url: URL, context: ResolveContext): Promise<MediaItem> {
  let sourceUrl = url.toString();
  let awemeId = extractAwemeId(url);

  if (!awemeId) {
    try {
      sourceUrl = await followRedirect(sourceUrl, {
        headers: { referer: 'https://www.douyin.com/' },
        cookie: context.cookie,
        timeoutMs: context.timeoutMs,
      });
    } catch (error) {
      if (error instanceof ResolveError) {
        throw new ResolveError('blocked', '抖音短链解析失败，可能需要配置 Cookie 或链接已失效', {
          cause: error,
          url: sourceUrl,
        });
      }
      throw error;
    }
    awemeId = extractAwemeId(new URL(sourceUrl));
  }

  if (!awemeId) {
    throw new ResolveError('unsupported_url', '没有识别到抖音作品 ID，请复制作品页或分享链接');
  }

  const kindHint = /\/note\//.test(sourceUrl) ? 'note' : 'video';
  const item = await loadDouyinItem(awemeId, kindHint, context);
  const id = item.aweme_id ?? awemeId;
  const images = buildImages(item);
  const variants = buildVideoVariants(item);
  const kind = images.length > 0 ? 'images' : 'video';

  if (kind === 'images' && images.length === 0) {
    throw new ResolveError('parse_failed', '这条抖音作品没有可下载的图片');
  }
  if (kind === 'video' && variants.length === 0) {
    throw new ResolveError('parse_failed', '这条抖音作品没有可下载的视频地址');
  }

  const title = (item.desc ?? '').trim() || `抖音作品 ${id}`;
  context.log?.(`抖音：${title}`);

  return {
    platform: 'douyin',
    platformName: '抖音',
    platformItemId: id,
    title,
    author: item.author?.nickname,
    coverUrl: urlsOf(item.video?.cover)[0] ?? images[0]?.url,
    pageUrl: `https://www.douyin.com/${kind === 'images' ? 'note' : 'video'}/${id}`,
    kind,
    variants: kind === 'video' ? variants : [],
    images: kind === 'images' ? images : undefined,
    durationSec: item.video?.duration ? Math.round(item.video.duration / 1000) : undefined,
  };
}

export const douyinAdapter: PlatformAdapter = {
  id: 'douyin',
  name: '抖音',
  match(url) {
    const host = url.hostname.toLowerCase();
    return (
      host === 'douyin.com' ||
      host.endsWith('.douyin.com') ||
      host === 'iesdouyin.com' ||
      host.endsWith('.iesdouyin.com')
    );
  },
  resolve: resolveDouyin,
};
