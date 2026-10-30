import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { ResolveError } from './errors.js';
import type { DouyinItem } from './platforms/douyin-types.js';

const DEFAULT_TIMEOUT_MS = 45_000;
const BROWSER_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--lang=zh-CN',
  '--disable-blink-features=AutomationControlled',
];

const NOTE_READY = `(() => {
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot && visit(element.shadowRoot)) return true;
      if (element instanceof HTMLImageElement) {
        const src = element.currentSrc || element.src;
        if (src && src.includes('biz_tag=aweme_images')) return true;
      }
    }
    return false;
  };
  return visit(document);
})()`;

const NOTE_COLLECT = `(() => {
  const images = [];
  const seen = new Set();
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) visit(element.shadowRoot);
      if (!(element instanceof HTMLImageElement)) continue;
      const src = element.currentSrc || element.src;
      if (!src || !src.includes('biz_tag=aweme_images') || seen.has(src)) continue;
      seen.add(src);
      images.push({
        url: src,
        width: element.naturalWidth,
        height: element.naturalHeight,
        alt: element.alt,
      });
    }
  };
  visit(document);
  return { images, title: document.title };
})()`;

export interface DouyinCaptureOptions {
  kind?: 'video' | 'note';
  timeoutMs?: number;
  log?: (message: string) => void;
}

let browserPromise: Promise<Browser> | undefined;
let queue: Promise<unknown> = Promise.resolve();

export function findBrowserExecutable(): string | undefined {
  const configured = process.env.MEDIA_SAVER_BROWSER?.trim();
  if (configured) return configured;

  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    candidates.push(
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }

  return candidates.find((candidate) => existsSync(candidate));
}

export function isBrowserAvailable(): boolean {
  return Boolean(findBrowserExecutable());
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new ResolveError(
      'blocked',
      '没有找到 Chrome 或 Edge。抖音解析需要本机浏览器，请安装浏览器，或用 MEDIA_SAVER_BROWSER 指定可执行文件路径',
    );
  }

  try {
    const browser = await puppeteer.launch({
      executablePath,
      headless: process.env.MEDIA_SAVER_HEADLESS !== '0',
      userDataDir: join(homedir(), '.media-saver', 'browser-profile'),
      args: BROWSER_ARGS,
    });
    browser.on('disconnected', () => {
      browserPromise = undefined;
    });
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ResolveError('blocked', `无法启动浏览器：${message}`, { cause: error });
  }
}

async function getBrowser(): Promise<Browser> {
  browserPromise ??= launchBrowser();
  try {
    return await browserPromise;
  } catch (error) {
    browserPromise = undefined;
    throw error;
  }
}

async function browserUserAgent(browser: Browser): Promise<string> {
  try {
    const userAgent = await browser.userAgent();
    return userAgent.replace('HeadlessChrome', 'Chrome').replace('HeadlessEdg', 'Edg');
  } catch {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
}

/**
 * 打开抖音作品页并截获详情接口响应。
 * 页面自身会完成 a_bogus / Argus 签名，避免在工具里维护签名算法。
 */
export async function captureDouyinDetail(
  awemeId: string,
  options: DouyinCaptureOptions = {},
): Promise<DouyinItem> {
  return enqueue(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      await page.setUserAgent(await browserUserAgent(browser));
      await page.setViewport({ width: 1280, height: 800 });

      const detail = await new Promise<DouyinItem>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(
            new ResolveError(
              'blocked',
              '抖音页面没有返回作品数据。可能是安全验证或需要登录：设置 MEDIA_SAVER_HEADLESS=0 重新运行，在弹出的浏览器里完成验证或扫码登录后重试',
            ),
          );
        }, timeoutMs);

        const finish = (value: DouyinItem): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };

        page.on('response', (response) => {
          if (!response.url().includes('/aweme/v1/web/aweme/detail/')) return;
          response
            .json()
            .then((payload) => {
              const item = (payload as { aweme_detail?: DouyinItem }).aweme_detail;
              if (!item) return;
              const detailId = item.aweme_id ? String(item.aweme_id) : '';
              if (
                !detailId ||
                detailId === awemeId ||
                detailId.endsWith(awemeId) ||
                awemeId.endsWith(detailId)
              ) {
                finish(item);
              }
            })
            .catch(() => {});
        });

        page.on('error', (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new ResolveError('blocked', `浏览器页面崩溃：${error.message}`));
        });

        const target = `https://www.douyin.com/${options.kind === 'note' ? 'note' : 'video'}/${awemeId}`;
        options.log?.(`抖音：打开 ${target}`);
        page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      });

      return detail;
    } finally {
      await page.close().catch(() => {});
    }
  });
}

export async function captureDouyinNote(
  awemeId: string,
  options: DouyinCaptureOptions = {},
): Promise<DouyinItem> {
  return enqueue(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      await page.setUserAgent(await browserUserAgent(browser));
      await page.setViewport({ width: 1280, height: 900 });
      const target = `https://www.douyin.com/note/${awemeId}`;
      options.log?.(`抖音：打开 ${target}`);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page
        .waitForFunction(NOTE_READY, { timeout: Math.min(timeoutMs, 20_000) })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const data = (await page.evaluate(NOTE_COLLECT)) as {
        images?: Array<{ url: string; width: number; height: number; alt?: string }>;
        title?: string;
      };
      const images = data.images ?? [];
      if (images.length === 0) {
        throw new ResolveError('parse_failed', '抖音图集页面没有找到图片');
      }

      const caption = images.find((image) => image.alt?.trim())?.alt ?? data.title ?? '';
      const title = caption.replace(/\s*-\s*抖音\s*$/, '').trim() || `抖音图集 ${awemeId}`;

      return {
        aweme_id: awemeId,
        desc: title,
        images: images.map((image) => ({
          url_list: [image.url],
          width: image.width,
          height: image.height,
        })),
      };
    } catch (error) {
      if (error instanceof ResolveError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ResolveError('blocked', `抖音图集页面加载失败：${message}`, { cause: error });
    } finally {
      await page.close().catch(() => {});
    }
  });
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (!pending) return;
  const browser = await pending.catch(() => undefined);
  await browser?.close().catch(() => {});
}
