import { createHash } from 'node:crypto';
import { ResolveError } from '../errors.js';
import { DEFAULT_USER_AGENT, fetchJson, followRedirect } from '../http.js';
import type {
  MediaItem,
  MediaStream,
  MediaVariant,
  PlatformAdapter,
  ResolveContext,
} from '../types.js';

const API_ROOT = 'https://api.bilibili.com';
const REFERER = 'https://www.bilibili.com/';
const BVID_PATTERN = /BV[0-9A-Za-z]{10}/;
const AID_PATTERN = /\/video\/av(\d+)/i;

const QUALITY_INFO: Record<number, { label: string; key: string; rank: number }> = {
  127: { label: '8K 超高清', key: '8k', rank: 127 },
  126: { label: '杜比视界', key: 'dolby-vision', rank: 126 },
  125: { label: 'HDR 真彩', key: 'hdr', rank: 125 },
  120: { label: '4K 超清', key: '4k', rank: 120 },
  116: { label: '1080P60 高帧率', key: '1080p60', rank: 116 },
  112: { label: '1080P+ 高码率', key: '1080p+', rank: 112 },
  80: { label: '1080P 高清', key: '1080p', rank: 80 },
  74: { label: '720P60 高帧率', key: '720p60', rank: 74 },
  64: { label: '720P 高清', key: '720p', rank: 64 },
  32: { label: '480P 标清', key: '480p', rank: 32 },
  16: { label: '360P 流畅', key: '360p', rank: 16 },
  6: { label: '240P 极速', key: '240p', rank: 6 },
};

const QUALITY_RANK = new Map(
  Object.entries(QUALITY_INFO).map(([id, info]) => [info.key, { rank: info.rank, id: Number(id) }]),
);

const WBI_MIXIN_KEY_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const CDN_HEADERS = {
  referer: REFERER,
  'user-agent': DEFAULT_USER_AGENT,
};

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

interface ViewPage {
  cid: number;
  page: number;
  part?: string;
  duration?: number;
}

interface ViewData {
  bvid?: string;
  aid?: number;
  title?: string;
  pic?: string;
  duration?: number;
  owner?: { name?: string };
  pages?: ViewPage[];
}

interface DashStream {
  id: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  codecs?: string;
  width?: number;
  height?: number;
}

interface PlayData {
  quality?: number;
  accept_quality?: number[];
  dash?: { video?: DashStream[]; audio?: DashStream[] };
  durl?: Array<{ url?: string; backup_url?: string[]; size?: number }>;
}

interface WbiKeys {
  imgKey: string;
  subKey: string;
  expiresAt: number;
}

let wbiCache: WbiKeys | undefined;

function apiError(code: number | undefined, message?: string): ResolveError {
  const detail = message ? `：${message}` : '';
  if (code === -404 || code === 62002 || code === 62004) {
    return new ResolveError('not_found', `视频不存在或已失效${detail}`);
  }
  if (code === -403 || code === -10403 || code === -101) {
    return new ResolveError('login_required', `该视频需要登录、大会员或对应地区权限${detail}`);
  }
  return new ResolveError('upstream', `B 站接口返回错误 ${code ?? '未知'}${detail}`);
}

function absoluteUrl(url: string): string {
  return url.replace(/^http:\/\//, 'https://');
}

function filenameKey(url: string): string {
  const name = url.split('/').pop() ?? '';
  return name.split('.')[0] ?? '';
}

function mixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`;
  return WBI_MIXIN_KEY_TAB.map((index) => raw[index] ?? '')
    .join('')
    .slice(0, 32);
}

/** 给 wbi/playurl 生成带 w_rid 的查询串 */
export function signWbiParams(
  params: Record<string, string>,
  imgKey: string,
  subKey: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const all: Record<string, string> = { ...params, wts: String(timestamp) };
  const query = Object.keys(all)
    .sort()
    .map((key) => {
      const value = (all[key] ?? '').replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = createHash('md5')
    .update(`${query}${mixinKey(imgKey, subKey)}`)
    .digest('hex');
  return `${query}&w_rid=${wRid}`;
}

async function getWbiKeys(context: ResolveContext): Promise<{ imgKey: string; subKey: string }> {
  if (wbiCache && wbiCache.expiresAt > Date.now()) {
    return { imgKey: wbiCache.imgKey, subKey: wbiCache.subKey };
  }

  const response = await fetchJson<
    ApiEnvelope<{ wbi_img?: { img_url?: string; sub_url?: string } }>
  >(`${API_ROOT}/x/web-interface/nav`, {
    headers: { referer: REFERER },
    cookie: context.cookie,
    timeoutMs: context.timeoutMs,
  });

  const imgUrl = response.data?.wbi_img?.img_url;
  const subUrl = response.data?.wbi_img?.sub_url;
  if (!imgUrl || !subUrl) {
    throw new ResolveError('parse_failed', '无法获取 B 站 WBI 密钥');
  }

  wbiCache = {
    imgKey: filenameKey(imgUrl),
    subKey: filenameKey(subUrl),
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
  return { imgKey: wbiCache.imgKey, subKey: wbiCache.subKey };
}

async function normalizePageUrl(url: URL, context: ResolveContext): Promise<string> {
  const host = url.hostname.toLowerCase();
  const isShortLink =
    host === 'b23.tv' ||
    host.endsWith('.b23.tv') ||
    host === 'bili2233.cn' ||
    host.endsWith('.bili2233.cn');
  if (!isShortLink) return url.toString();

  return followRedirect(url.toString(), {
    headers: { referer: REFERER },
    cookie: context.cookie,
    timeoutMs: context.timeoutMs,
  });
}

async function fetchView(
  bvid: string | undefined,
  aid: string | undefined,
  context: ResolveContext,
): Promise<ViewData> {
  const query = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${encodeURIComponent(aid ?? '')}`;
  const response = await fetchJson<ApiEnvelope<ViewData>>(
    `${API_ROOT}/x/web-interface/view?${query}`,
    {
      headers: { referer: REFERER },
      cookie: context.cookie,
      timeoutMs: context.timeoutMs,
    },
  );

  if (response.code !== 0 || !response.data) {
    throw apiError(response.code, response.message);
  }
  return response.data;
}

async function fetchPlayData(
  bvid: string,
  cid: number,
  fnval: string,
  context: ResolveContext,
): Promise<PlayData | undefined> {
  const params: Record<string, string> = {
    bvid,
    cid: String(cid),
    qn: '120',
    fnval,
    fnver: '0',
    fourk: '1',
  };
  const baseUrl = `${API_ROOT}/x/player/playurl`;
  const options = {
    headers: { referer: REFERER },
    cookie: context.cookie,
    timeoutMs: context.timeoutMs,
  };

  const first = await fetchJson<ApiEnvelope<PlayData>>(
    `${baseUrl}?${new URLSearchParams(params).toString()}`,
    options,
  );
  if (first.code === 0) return first.data;

  if (first.code === -403 || first.code === -352 || first.code === -401) {
    const keys = await getWbiKeys(context);
    const query = signWbiParams(params, keys.imgKey, keys.subKey);
    const signed = await fetchJson<ApiEnvelope<PlayData>>(
      `${API_ROOT}/x/player/wbi/playurl?${query}`,
      options,
    );
    if (signed.code === 0) return signed.data;
    throw apiError(signed.code, signed.message);
  }

  throw apiError(first.code, first.message);
}

function pickCodec(streams: DashStream[]): DashStream | undefined {
  const rank = (codecs: string | undefined): number => {
    if (!codecs) return 9;
    if (codecs.startsWith('avc1')) return 0;
    if (codecs.startsWith('hev1') || codecs.startsWith('hvc1')) return 1;
    if (codecs.startsWith('av01')) return 2;
    return 3;
  };
  return [...streams].sort((a, b) => {
    const byCodec = rank(a.codecs) - rank(b.codecs);
    if (byCodec !== 0) return byCodec;
    return (b.bandwidth ?? 0) - (a.bandwidth ?? 0);
  })[0];
}

function codecLabel(codecs: string | undefined): string {
  if (!codecs) return '';
  if (codecs.startsWith('avc1')) return 'AVC';
  if (codecs.startsWith('hev1') || codecs.startsWith('hvc1')) return 'HEVC';
  if (codecs.startsWith('av01')) return 'AV1';
  return '';
}

function bestAudio(streams: DashStream[] | undefined): MediaStream | undefined {
  const stream = [...(streams ?? [])]
    .filter((item) => item.baseUrl ?? item.base_url)
    .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  if (!stream) return undefined;
  const url = stream.baseUrl ?? stream.base_url;
  if (!url) return undefined;
  return {
    url: absoluteUrl(url),
    backupUrls: (stream.backupUrl ?? stream.backup_url)?.map(absoluteUrl),
    ext: 'm4a',
    headers: CDN_HEADERS,
  };
}

function buildDashVariants(play: PlayData): MediaVariant[] {
  const videos = play.dash?.video ?? [];
  if (videos.length === 0) return [];
  const audio = bestAudio(play.dash?.audio);

  const grouped = new Map<number, DashStream[]>();
  for (const stream of videos) {
    const list = grouped.get(stream.id) ?? [];
    list.push(stream);
    grouped.set(stream.id, list);
  }

  const variants: MediaVariant[] = [];
  for (const [id, streams] of grouped) {
    const stream = pickCodec(streams);
    const source = stream?.baseUrl ?? stream?.base_url;
    if (!stream || !source) continue;

    const info = QUALITY_INFO[id] ?? {
      label: `${stream.height ?? id}P`,
      key: `q${id}`,
      rank: id,
    };
    const codec = codecLabel(stream.codecs);
    variants.push({
      id: `dash-${id}`,
      label: codec ? `${info.label} · ${codec}` : info.label,
      kind: 'video',
      quality: info.key,
      watermark: 'none',
      ext: 'mp4',
      video: {
        url: absoluteUrl(source),
        backupUrls: (stream.backupUrl ?? stream.backup_url)?.map(absoluteUrl),
        ext: 'm4s',
        headers: CDN_HEADERS,
      },
      audio,
      requiresFfmpeg: Boolean(audio),
    });
  }
  return variants;
}

function buildDurlVariant(play: PlayData): MediaVariant[] {
  const segments = play.durl ?? [];
  if (segments.length !== 1) return [];
  const segment = segments[0];
  if (!segment?.url) return [];

  const info = QUALITY_INFO[play.quality ?? 64] ?? {
    label: `${play.quality ?? '未知'}P`,
    key: `q${play.quality ?? 0}`,
    rank: play.quality ?? 0,
  };
  return [
    {
      id: `durl-${play.quality ?? 64}`,
      label: `${info.label} · 单文件`,
      kind: 'video',
      quality: info.key,
      watermark: 'none',
      ext: 'mp4',
      url: absoluteUrl(segment.url),
      backupUrls: segment.backup_url?.map(absoluteUrl),
      headers: CDN_HEADERS,
      requiresFfmpeg: false,
    },
  ];
}

function variantRank(variant: MediaVariant): number {
  const known = QUALITY_RANK.get(variant.quality);
  if (known) return known.rank;
  const digit = Number(variant.quality.replace(/\D/g, ''));
  return Number.isFinite(digit) ? digit : 0;
}

async function resolveBilibili(url: URL, context: ResolveContext): Promise<MediaItem> {
  const pageUrl = await normalizePageUrl(url, context);
  if (pageUrl.includes('/bangumi/')) {
    throw new ResolveError('unsupported_url', '暂不支持番剧链接，请使用普通视频链接');
  }

  const bvid = pageUrl.match(BVID_PATTERN)?.[0];
  const aid = bvid ? undefined : pageUrl.match(AID_PATTERN)?.[1];
  if (!bvid && !aid) {
    throw new ResolveError('unsupported_url', '没有识别到 B 站视频 ID');
  }

  const view = await fetchView(bvid, aid, context);
  const resolvedBvid = view.bvid ?? bvid;
  if (!resolvedBvid) {
    throw new ResolveError('parse_failed', '没有解析到 BV 号');
  }

  const parsed = new URL(pageUrl);
  const requestedPage = Math.max(1, Number(parsed.searchParams.get('p') ?? '1') || 1);
  const pages = view.pages ?? [];
  const page = pages[Math.min(requestedPage, pages.length) - 1] ?? pages[0];
  if (!page?.cid) {
    throw new ResolveError('parse_failed', '没有找到视频分 P 信息');
  }

  const multiPart = pages.length > 1;
  const title =
    multiPart && page.part
      ? `${view.title ?? resolvedBvid} - ${page.part}`
      : (view.title ?? resolvedBvid);

  const [dashPlay, durlPlay] = await Promise.all([
    fetchPlayData(resolvedBvid, page.cid, '4048', context).catch(() => undefined),
    fetchPlayData(resolvedBvid, page.cid, '0', context).catch(() => undefined),
  ]);

  const variants = [...buildDashVariants(dashPlay ?? {}), ...buildDurlVariant(durlPlay ?? {})].sort(
    (a, b) => variantRank(b) - variantRank(a),
  );

  if (variants.length === 0) {
    throw new ResolveError(
      'blocked',
      '没有拿到可下载的清晰度，可能需要登录 Cookie 或该视频有地区限制',
    );
  }

  context.log?.(`B 站清晰度：${variants.map((item) => item.quality).join(', ')}`);
  return {
    platform: 'bilibili',
    platformName: '哔哩哔哩',
    platformItemId: multiPart ? `${resolvedBvid}-p${page.page}` : resolvedBvid,
    title,
    author: view.owner?.name,
    coverUrl: view.pic,
    pageUrl: `https://www.bilibili.com/video/${resolvedBvid}/?p=${page.page}`,
    kind: 'video',
    variants,
    durationSec: page.duration ?? view.duration,
  };
}

export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  name: '哔哩哔哩',
  match(url) {
    const host = url.hostname.toLowerCase();
    return (
      host === 'bilibili.com' ||
      host.endsWith('.bilibili.com') ||
      host === 'b23.tv' ||
      host.endsWith('.b23.tv') ||
      host === 'bili2233.cn' ||
      host.endsWith('.bili2233.cn')
    );
  },
  resolve: resolveBilibili,
};
