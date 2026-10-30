#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import type { DownloadProgress, MediaItem, MediaVariant, PlatformId } from '@media-saver/core';
import {
  closeBrowser,
  downloadImages,
  downloadVariant,
  findAdapter,
  formatBytes,
  ResolveError,
  recordDownload,
  resolveMedia,
} from '@media-saver/core';
import { Command } from 'commander';
import pc from 'picocolors';

const VERSION = '0.1.0';
const DEFAULT_OUT_DIR = join(homedir(), 'Downloads', 'MediaSaver');
const COOKIE_FILE = join(homedir(), '.media-saver', 'cookies.json');

interface CliOptions {
  list?: boolean;
  variant?: string;
  out: string;
  cookie?: string;
  imageFormat?: string;
  json?: boolean;
}

async function readCookie(platform: PlatformId): Promise<string | undefined> {
  try {
    const raw = await readFile(COOKIE_FILE, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const value = data[platform];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function shortenTitle(title: string): string {
  return title.length > 80 ? `${title.slice(0, 80)}…` : title;
}

function printItem(item: MediaItem): void {
  console.log(pc.bold(shortenTitle(item.title)));
  const meta = [
    item.platformName,
    item.author,
    item.durationSec ? formatDuration(item.durationSec) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(pc.dim(meta));
  console.log(pc.dim(item.pageUrl));
  console.log('');

  if (item.kind === 'images') {
    console.log(`共 ${item.images?.length ?? 0} 张图片：`);
    for (const [index, image] of (item.images ?? []).entries()) {
      console.log(`  ${index + 1}. ${image.label ?? image.id}`);
    }
    return;
  }

  console.log('可用版本：');
  for (const [index, variant] of item.variants.entries()) {
    const flags = [variant.id, variant.requiresFfmpeg ? '需要 ffmpeg' : undefined]
      .filter(Boolean)
      .join(' · ');
    console.log(`  ${String(index + 1).padStart(2)}. ${variant.label}  ${pc.dim(flags)}`);
  }
}

function chooseVariant(item: MediaItem, requested: string | undefined): MediaVariant {
  if (item.variants.length === 0) {
    throw new ResolveError('parse_failed', '没有可下载的版本');
  }
  if (!requested) {
    return item.variants[0] as MediaVariant;
  }

  const exact = item.variants.find((variant) => variant.id === requested);
  if (exact) return exact;

  const normalized = requested.toLowerCase();
  const matches = item.variants.filter(
    (variant) =>
      variant.quality.toLowerCase() === normalized ||
      variant.label.toLowerCase().includes(normalized),
  );
  if (matches.length === 0) {
    throw new ResolveError('parse_failed', `没有找到版本：${requested}，用 --list 查看可用版本`);
  }

  return matches.sort(
    (a, b) => Number(a.requiresFfmpeg ?? false) - Number(b.requiresFfmpeg ?? false),
  )[0] as MediaVariant;
}

function renderProgress(progress: DownloadProgress): string {
  if (progress.phase === 'merge') return '合并音视频…';
  const label = progress.phase === 'audio' ? '音频' : progress.phase === 'image' ? '图片' : '视频';
  if (progress.total) {
    const percent = Math.min(100, Math.floor((progress.received / progress.total) * 100));
    return `${label} ${percent}% ${formatBytes(progress.received)} / ${formatBytes(progress.total)}`;
  }
  return `${label} ${formatBytes(progress.received)}`;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('media-saver')
    .description('抖音 / 小红书 / 哔哩哔哩视频与图集下载')
    .version(VERSION)
    .argument('<url>', '作品链接或分享文本')
    .option('-l, --list', '只列出可用版本，不下载')
    .option('-v, --variant <id>', '指定版本 id 或清晰度')
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .option('--image-format <format>', '图集输出格式：jpg 或 original', 'jpg')
    .option('--cookie <cookie>', '直接传入目标平台的 Cookie')
    .option('--json', '输出解析结果的 JSON')
    .action(async (input: string, options: CliOptions) => {
      try {
        const adapter = findAdapter(input);
        if (!adapter) {
          throw new ResolveError('unsupported_url', '暂不支持这个链接');
        }

        const cookie = options.cookie?.trim() || (await readCookie(adapter.id));
        const item = await resolveMedia(input, { cookie });

        if (options.json) {
          console.log(JSON.stringify(item, null, 2));
          return;
        }
        if (options.list) {
          printItem(item);
          return;
        }

        const outputDir = resolvePath(options.out);
        let lastLine = '';
        const onProgress = (progress: DownloadProgress): void => {
          if (!process.stdout.isTTY) return;
          const line = renderProgress(progress);
          if (line !== lastLine) {
            process.stdout.write(`\r\u001b[K${line}`);
            lastLine = line;
          }
        };

        if (item.kind === 'images') {
          const imageFormat = options.imageFormat === 'original' ? 'original' : 'jpg';
          if (
            options.imageFormat &&
            options.imageFormat !== 'jpg' &&
            options.imageFormat !== 'original'
          ) {
            throw new ResolveError('parse_failed', '--image-format 只支持 jpg 或 original');
          }
          printItem(item);
          console.log(pc.dim(imageFormat === 'jpg' ? '图片将转换为 JPG' : '保留原始图片格式'));
          const paths = await downloadImages(item, { outputDir, onProgress, imageFormat });
          const firstPath = paths[0];
          const folderPath = firstPath ? dirname(firstPath) : outputDir;
          await recordDownload({
            item,
            filename: basename(folderPath),
            path: folderPath,
            imageCount: paths.length,
          }).catch(() => {});
          if (lastLine) process.stdout.write('\r\u001b[K');
          console.log(pc.green(`已保存 ${paths.length} 张图片：${folderPath}`));
          return;
        }

        const variant = chooseVariant(item, options.variant);
        console.log(`${pc.bold(shortenTitle(item.title))}  ${pc.dim(`[${variant.label}]`)}`);

        const path = await downloadVariant(item, variant, { outputDir, onProgress });
        await recordDownload({
          item,
          filename: basename(path),
          path,
          variant,
        }).catch(() => {});
        if (lastLine) process.stdout.write('\r\u001b[K');
        console.log(pc.green(`已保存：${path}`));
      } finally {
        await closeBrowser();
      }
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof ResolveError) {
      console.error(pc.red(`错误：${error.message}`));
      if (error.code === 'ffmpeg_missing') {
        console.error(pc.dim('安装 ffmpeg 后可下载高清 DASH 版本，或用 --list 选择“单文件”版本。'));
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`错误：${message}`));
    }
    process.exitCode = 1;
  }
}

void main();
