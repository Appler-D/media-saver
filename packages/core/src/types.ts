export type PlatformId = 'douyin' | 'bilibili' | 'xiaohongshu';

export type WatermarkState = 'none' | 'watermarked';

export interface MediaStream {
  url: string;
  /** CDN 备用地址，主地址失败时依次尝试 */
  backupUrls?: string[];
  ext: string;
  /** 下载该流时必须携带的请求头（如 Referer） */
  headers?: Record<string, string>;
  sizeBytes?: number;
}

export interface MediaVariant {
  id: string;
  label: string;
  kind: 'video';
  quality: string;
  watermark: WatermarkState;
  ext: string;
  /** 单文件直链；与 video/audio 二选一 */
  url?: string;
  backupUrls?: string[];
  /** DASH 分离流，需要 ffmpeg 合并 */
  video?: MediaStream;
  audio?: MediaStream;
  requiresFfmpeg?: boolean;
  headers?: Record<string, string>;
}

export interface MediaImage {
  id: string;
  url: string;
  ext: string;
  label?: string;
  watermark: WatermarkState;
  headers?: Record<string, string>;
  width?: number;
  height?: number;
}

export interface MediaItem {
  platform: PlatformId;
  platformName: string;
  platformItemId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  pageUrl: string;
  kind: 'video' | 'images';
  variants: MediaVariant[];
  images?: MediaImage[];
  durationSec?: number;
}

export interface ResolveContext {
  /** 目标平台的原始 Cookie 请求头，例如 `SESSDATA=...; bili_jct=...;` */
  cookie?: string;
  userAgent?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly name: string;
  match(url: URL): boolean;
  resolve(url: URL, context: ResolveContext): Promise<MediaItem>;
}
