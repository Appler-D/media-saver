import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ResolveError } from './errors.js';
import { buildHeaders } from './http.js';
import type { MediaImage, MediaItem, MediaStream, MediaVariant } from './types.js';
import { sanitizeFilename } from './util/filename.js';

export interface DownloadProgress {
  phase: 'video' | 'audio' | 'image' | 'merge';
  received: number;
  total?: number;
}

export interface DownloadOptions {
  outputDir: string;
  filename?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

let ffmpegCache: Promise<string | undefined> | undefined;

export function findFfmpeg(): Promise<string | undefined> {
  ffmpegCache ??= (async () => {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
      const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
      if (result.status === 0) return 'ffmpeg';
    } catch {
      // 未安装系统 ffmpeg
    }

    try {
      const mod = (await import('@ffmpeg-installer/ffmpeg')) as unknown as {
        default?: { path?: string };
        path?: string;
      };
      const path = mod.default?.path ?? mod.path;
      if (path && existsSync(path)) return path;
    } catch {
      // 可选依赖未安装
    }

    return undefined;
  })();
  return ffmpegCache;
}

export function resetFfmpegCache(): void {
  ffmpegCache = undefined;
}

function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const base = path.slice(0, path.length - ext.length);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

function streamUrls(stream: MediaStream): string[] {
  return [stream.url, ...(stream.backupUrls ?? [])].filter(Boolean);
}

async function downloadStream(
  stream: MediaStream,
  targetPath: string,
  phase: DownloadProgress['phase'],
  options: DownloadOptions,
): Promise<void> {
  const urls = streamUrls(stream);
  let lastError: unknown;

  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { headers: buildHeaders({ headers: stream.headers }) });
        if (!response.ok || !response.body) {
          throw new ResolveError('download_failed', `下载失败：HTTP ${response.status}`, { url });
        }

        const total = Number(response.headers.get('content-length')) || undefined;
        let received = 0;
        const source = Readable.fromWeb(response.body);
        source.on('data', (chunk: Buffer) => {
          received += chunk.length;
          options.onProgress?.({ phase, received, total });
        });

        await pipeline(source, createWriteStream(targetPath));
        if (received === 0) throw new ResolveError('download_failed', '下载到的文件为空');
        return;
      } catch (error) {
        lastError = error;
        await rm(targetPath, { force: true });
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new ResolveError('download_failed', `下载失败：${message}`);
}

async function mergeWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  options: DownloadOptions,
): Promise<void> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    throw new ResolveError(
      'ffmpeg_missing',
      '这个清晰度需要合并音视频，但没有找到 ffmpeg。请安装 ffmpeg 后重试，或选择“单文件”版本。',
    );
  }

  options.onProgress?.({ phase: 'merge', received: 0 });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-y', '-i', videoPath, '-i', audioPath, '-c', 'copy', '-movflags', '+faststart', outputPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.on('error', (error) => {
      reject(new ResolveError('download_failed', `无法启动 ffmpeg：${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new ResolveError('download_failed', `ffmpeg 合并失败：${stderr}`));
    });
  });
}

export function variantFilename(item: MediaItem, variant: MediaVariant): string {
  const suffix =
    variant.watermark === 'watermarked'
      ? '带水印'
      : `${variant.quality === 'source' ? '原画' : variant.quality}-无水印`;
  const maxTitleLength = Math.max(10, 120 - suffix.length - 1);
  const title = sanitizeFilename(item.title).slice(0, maxTitleLength);
  return sanitizeFilename(`${title}-${suffix}`);
}

export async function downloadVariant(
  item: MediaItem,
  variant: MediaVariant,
  options: DownloadOptions,
): Promise<string> {
  await mkdir(options.outputDir, { recursive: true });
  const filename = sanitizeFilename(options.filename ?? variantFilename(item, variant));
  const target = uniquePath(join(options.outputDir, `${filename}.${variant.ext}`));

  if (variant.url) {
    await downloadStream(
      {
        url: variant.url,
        backupUrls: variant.backupUrls,
        ext: variant.ext,
        headers: variant.headers,
      },
      target,
      'video',
      options,
    );
    return target;
  }

  if (!variant.video) {
    throw new ResolveError('parse_failed', '这个版本没有可下载的地址');
  }

  if (variant.audio && !(await findFfmpeg())) {
    throw new ResolveError(
      'ffmpeg_missing',
      '这个清晰度需要合并音视频，但没有找到 ffmpeg。请安装 ffmpeg 后重试，或选择“单文件”版本。',
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'media-saver-'));
  try {
    const videoPath = join(tempDir, `video.${variant.video.ext}`);
    await downloadStream(variant.video, videoPath, 'video', options);

    if (!variant.audio) {
      await copyFile(videoPath, target);
      return target;
    }

    const audioPath = join(tempDir, `audio.${variant.audio.ext}`);
    await downloadStream(variant.audio, audioPath, 'audio', options);
    await mergeWithFfmpeg(videoPath, audioPath, target, options);
    return target;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function downloadImage(
  image: MediaImage,
  options: DownloadOptions & { filename?: string },
): Promise<string> {
  await mkdir(options.outputDir, { recursive: true });
  const filename = sanitizeFilename(options.filename ?? image.id ?? 'image');
  const target = uniquePath(join(options.outputDir, `${filename}.${image.ext}`));
  await downloadStream(
    { url: image.url, ext: image.ext, headers: image.headers },
    target,
    'image',
    options,
  );
  return target;
}

export async function downloadImages(item: MediaItem, options: DownloadOptions): Promise<string[]> {
  const images = item.images ?? [];
  if (images.length === 0) {
    throw new ResolveError('parse_failed', '这条内容没有图片');
  }

  const folderName = sanitizeFilename(options.filename ?? item.title);
  const outputDir = uniquePath(join(options.outputDir, folderName));
  await mkdir(outputDir, { recursive: true });

  const paths: string[] = [];
  for (const [index, image] of images.entries()) {
    const target = join(outputDir, `${String(index + 1).padStart(2, '0')}.${image.ext}`);
    await downloadStream(
      { url: image.url, ext: image.ext, headers: image.headers },
      target,
      'image',
      options,
    );
    paths.push(target);
  }
  return paths;
}
