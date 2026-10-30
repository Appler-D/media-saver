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
import { extractJsonAfter } from '../util/json.js';

const XHS_HEADERS = {
  referer: 'https://www.xiaohongshu.com/',
  'user-agent': DEFAULT_USER_AGENT,
};

interface XhsImageInfo {
  imageScene?: string;
  url?: string;
}

interface XhsImage {
  urlDefault?: string;
  urlPre?: string;
  url?: string;
  infoList?: XhsImageInfo[];
  width?: number;
  height?: number;
}

interface XhsVideoStream {
  masterUrl?: string;
  backupUrls?: string[];
  width?: number;
  height?: number;
  avgBitrate?: number;
}

interface XhsVideo {
  media?: {
    stream?: {
      h264?: XhsVideoStream[];
      h265?: XhsVideoStream[];
      av1?: XhsVideoStream[];
    };
  };
  capa?: { duration?: number };
}

interface XhsNote {
  noteId?: string;
  title?: string;
  desc?: string;
  type?: string;
  user?: { nickname?: string };
  imageList?: XhsImage[];
  video?: XhsVideo;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function toHttps(url: string): string {
  return url.replace(/^http:\/\//, 'https://');
}

function extractNoteId(url: URL): string | undefined {
  const match = url.pathname.match(/\/(?:explore|discovery\/item|note)\/([0-9a-f]{24})/i);
  return match?.[1];
}

function findNote(node: unknown, depth = 0): XhsNote | undefined {
  if (depth > 15 || node === null || node === undefined) return undefined;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNote(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;

  const detailMap = record.noteDetailMap;
  if (detailMap && typeof detailMap === 'object') {
    for (const [key, value] of Object.entries(detailMap as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const note = (value as { note?: XhsNote }).note;
      if (note) return { ...note, noteId: note.noteId ?? key };
    }
  }

  if (
    typeof record.noteId === 'string' &&
    (Array.isArray(record.imageList) || typeof record.video === 'object')
  ) {
    return record as unknown as XhsNote;
  }

  for (const value of Object.values(record)) {
    const found = findNote(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function imageScore(image: XhsImage, info: XhsImageInfo | undefined): number {
  const url = info?.url ?? image.urlDefault ?? image.url ?? image.urlPre ?? '';
  let score = 0;
  if (info?.imageScene === 'WB_DFT') score += 4;
  if (url.includes('sns-img')) score += 3;
  if (/\.jpe?g(\?|$)/i.test(url)) score += 2;
  if (url.includes('sns-webpic')) score += 1;
  return score;
}

function pickImageUrl(image: XhsImage): string | undefined {
  const candidates: Array<{ url: string; score: number }> = [];
  for (const info of image.infoList ?? []) {
    if (isHttpUrl(info.url)) candidates.push({ url: info.url, score: imageScore(image, info) });
  }
  for (const url of [image.urlDefault, image.url, image.urlPre]) {
    if (isHttpUrl(url)) candidates.push({ url, score: imageScore(image, undefined) });
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.url;
}

function buildImages(note: XhsNote): MediaImage[] {
  return (note.imageList ?? [])
    .map((image, index): MediaImage | undefined => {
      const url = pickImageUrl(image);
      if (!url) return undefined;
      return {
        id: `image-${index + 1}`,
        url: toHttps(url),
        ext: extensionFromUrl(url, 'jpeg'),
        label: `图片 ${index + 1}`,
        watermark: 'none',
        headers: XHS_HEADERS,
        width: image.width,
        height: image.height,
      } satisfies MediaImage;
    })
    .filter((image): image is MediaImage => image !== undefined);
}

function streamVariants(
  streams: XhsVideoStream[] | undefined,
  labelPrefix: string,
): MediaVariant[] {
  return (streams ?? [])
    .map((stream, index): MediaVariant | undefined => {
      if (!isHttpUrl(stream.masterUrl)) return undefined;
      const height = stream.height ?? 0;
      const quality = height > 0 ? `${height}p` : 'source';
      const label = height > 0 ? `${height}P` : '原画';
      return {
        id: `xhs-${quality}-${index}`,
        label: labelPrefix ? `${label} · ${labelPrefix}` : label,
        kind: 'video',
        quality,
        watermark: 'none',
        ext: 'mp4',
        url: toHttps(stream.masterUrl),
        backupUrls: (stream.backupUrls ?? []).filter(isHttpUrl).map(toHttps),
        headers: XHS_HEADERS,
      } satisfies MediaVariant;
    })
    .filter((variant): variant is MediaVariant => variant !== undefined)
    .sort((a, b) => {
      const heightA = Number(a.quality.replace(/\D/g, '')) || 0;
      const heightB = Number(b.quality.replace(/\D/g, '')) || 0;
      return heightB - heightA;
    });
}

function buildVideoVariants(note: XhsNote): MediaVariant[] {
  const stream = note.video?.media?.stream;
  if (!stream) return [];

  const h264 = streamVariants(stream.h264, 'H.264');
  if (h264.length > 0) return h264;
  const h265 = streamVariants(stream.h265, 'H.265');
  if (h265.length > 0) return h265;
  return streamVariants(stream.av1, 'AV1');
}

function detectLoginWall(html: string): boolean {
  return /登录后查看|请先登录|扫码登录|login-container|reds-login/i.test(html);
}

function nestedRedirectTarget(url: URL): string | undefined {
  const direct = url.searchParams.get('originalUrl') ?? url.searchParams.get('redirectPath');
  if (direct) return direct;

  // 安全页会把 redirectPath 嵌在 source 参数里，外层参数解析取不到
  const match = url.search.match(/[?&]redirectPath=([^&]+)/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function normalizeSecurityRedirect(url: URL): URL {
  if (!url.pathname.startsWith('/404')) return url;
  const original = nestedRedirectTarget(url);
  if (!original) return url;
  try {
    const parsed = new URL(original);
    parsed.protocol = 'https:';
    return parsed;
  } catch {
    return url;
  }
}

async function resolveXiaohongshu(url: URL, context: ResolveContext): Promise<MediaItem> {
  let pageUrl = url.toString();
  let noteId = extractNoteId(url);

  if (!noteId) {
    pageUrl = await followRedirect(pageUrl, {
      headers: { referer: XHS_HEADERS.referer },
      cookie: context.cookie,
      timeoutMs: context.timeoutMs,
    });
    const redirect = new URL(pageUrl);
    if (redirect.searchParams.get('error_code') === '300031') {
      throw new ResolveError('not_found', '小红书分享链接已失效，请从 App 重新复制分享链接');
    }
    const normalized = normalizeSecurityRedirect(redirect);
    pageUrl = normalized.toString();
    noteId = extractNoteId(normalized);
  }

  if (!noteId) {
    throw new ResolveError('unsupported_url', '没有识别到小红书笔记 ID，请复制笔记页或分享链接');
  }

  if (new URL(pageUrl).pathname.includes('/login')) {
    throw new ResolveError(
      'login_required',
      '小红书要求登录，请在 cookies.json 里配置小红书 Cookie',
    );
  }

  const html = await fetchText(pageUrl, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      referer: XHS_HEADERS.referer,
      accept: 'text/html,application/xhtml+xml',
    },
    cookie: context.cookie,
    timeoutMs: context.timeoutMs,
  });

  if (/当前笔记暂时无法浏览|This Page Isn't Available|error_code=300031/i.test(html)) {
    throw new ResolveError(
      'not_found',
      '小红书笔记不存在或分享链接已失效，请从 App 重新复制分享链接',
    );
  }

  const state = extractJsonAfter(html, 'window.__INITIAL_STATE__');
  const note = state ? findNote(state) : undefined;

  if (!note) {
    if (detectLoginWall(html)) {
      throw new ResolveError(
        'login_required',
        '小红书要求登录或分享链接缺少 xsec_token，请从 App 重新复制分享链接，并配置 Cookie',
      );
    }
    throw new ResolveError('parse_failed', '没有在小红书页面里找到笔记数据');
  }

  const resolvedNoteId = note.noteId ?? noteId;
  const images = buildImages(note);
  const variants = buildVideoVariants(note);
  const isVideo = variants.length > 0 || note.type === 'video';
  const kind = isVideo ? 'video' : 'images';

  if (kind === 'images' && images.length === 0) {
    throw new ResolveError('parse_failed', '这条小红书笔记没有可下载的图片');
  }
  if (kind === 'video' && variants.length === 0) {
    throw new ResolveError('parse_failed', '这条小红书笔记没有可下载的视频地址');
  }

  const firstLine = (note.desc ?? '').split('\n')[0]?.trim() ?? '';
  const title =
    (note.title ?? '').trim() || firstLine.slice(0, 60) || `小红书笔记 ${resolvedNoteId}`;
  context.log?.(`小红书：${title}`);

  return {
    platform: 'xiaohongshu',
    platformName: '小红书',
    platformItemId: resolvedNoteId,
    title,
    author: note.user?.nickname,
    coverUrl: images[0]?.url,
    pageUrl,
    kind,
    variants,
    images: kind === 'images' ? images : undefined,
    durationSec: note.video?.capa?.duration,
  };
}

export const xiaohongshuAdapter: PlatformAdapter = {
  id: 'xiaohongshu',
  name: '小红书',
  match(url) {
    const host = url.hostname.toLowerCase();
    return (
      host === 'xiaohongshu.com' ||
      host.endsWith('.xiaohongshu.com') ||
      host === 'xhslink.com' ||
      host.endsWith('.xhslink.com') ||
      host === 'xhslink.cn' ||
      host.endsWith('.xhslink.cn')
    );
  },
  resolve: resolveXiaohongshu,
};
