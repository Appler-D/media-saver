import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { MediaItem } from '@media-saver/core';
import {
  clearHistory,
  closeBrowser,
  downloadVariant,
  request as fetchUpstream,
  findAdapter,
  findBrowserExecutable,
  findFfmpeg,
  ResolveError,
  readHistory,
  recordDownload,
  removeHistoryEntry,
  resolveMedia,
  sanitizeFilename,
} from '@media-saver/core';
import Fastify, { type FastifyInstance } from 'fastify';

const COOKIE_FILE = join(homedir(), '.media-saver', 'cookies.json');
const TEMP_DIR = join(homedir(), '.media-saver', 'web-temp');
const JOB_TTL_MS = 30 * 60 * 1000;
const REFERERS: Record<string, string> = {
  douyin: 'https://www.douyin.com/',
  bilibili: 'https://www.bilibili.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
};

interface Job {
  item: MediaItem;
  createdAt: number;
}

export interface MediaServerOptions {
  port?: number;
  host?: string;
  publicDir?: string;
}

export interface MediaServer {
  app: FastifyInstance;
  url: string;
  port: number;
  close: () => Promise<void>;
}

async function readCookies(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(COOKIE_FILE, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.trim()) result[key] = value.trim();
    }
    return result;
  } catch {
    return {};
  }
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4a: 'audio/mp4',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

function attachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function startMediaServer(options: MediaServerOptions = {}): Promise<MediaServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.PORT ?? 17890);
  const publicDir = options.publicDir ?? join(process.cwd(), 'apps', 'web', 'public');
  const app = Fastify({ logger: { level: 'warn' } });
  const jobs = new Map<string, Job>();

  const jobCleanup = setInterval(
    () => {
      const cutoff = Date.now() - JOB_TTL_MS;
      for (const [id, job] of jobs) {
        if (job.createdAt < cutoff) jobs.delete(id);
      }
    },
    10 * 60 * 1000,
  );
  jobCleanup.unref();

  function getJob(id: string): Job {
    const job = jobs.get(id);
    if (!job) {
      throw new ResolveError('not_found', '解析结果已过期，请重新解析');
    }
    return job;
  }

  await app.register(cors, {
    origin(origin, callback) {
      const allowed =
        !origin ||
        origin === `http://127.0.0.1:${port}` ||
        origin === `http://localhost:${port}` ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('moz-extension://') ||
        origin.startsWith('safari-web-extension://');
      callback(null, allowed);
    },
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/api/health', async () => {
    const cookies = await readCookies();
    return {
      ok: true,
      ffmpeg: Boolean(await findFfmpeg()),
      browser: Boolean(findBrowserExecutable()),
      cookies: {
        douyin: Boolean(cookies.douyin),
        bilibili: Boolean(cookies.bilibili),
        xiaohongshu: Boolean(cookies.xiaohongshu),
      },
    };
  });

  app.post<{ Body: { url?: string } }>('/api/resolve', async (request, reply) => {
    const input = request.body?.url?.trim();
    if (!input) {
      return reply.code(400).send({ error: { code: 'invalid_input', message: '请输入链接' } });
    }

    const adapter = findAdapter(input);
    if (!adapter) {
      throw new ResolveError('unsupported_url', '暂不支持这个链接');
    }

    const cookies = await readCookies();
    const item = await resolveMedia(input, { cookie: cookies[adapter.id] });
    const jobId = randomUUID();
    jobs.set(jobId, { item, createdAt: Date.now() });
    return { jobId, item };
  });

  app.get('/api/history', async () => {
    const history = await readHistory();
    return { items: history.items.slice(0, 50) };
  });

  app.delete('/api/history', async () => {
    await clearHistory();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/history/:id', async (request) => {
    await removeHistoryEntry(request.params.id);
    return { ok: true };
  });

  app.get<{ Params: { jobId: string } }>('/api/cover/:jobId', async (request, reply) => {
    const job = getJob(request.params.jobId);
    if (!job.item.coverUrl) {
      throw new ResolveError('not_found', '没有封面');
    }

    const upstream = await fetchUpstream(job.item.coverUrl, {
      headers: { referer: REFERERS[job.item.platform] ?? 'https://www.douyin.com/' },
      timeoutMs: 30_000,
    });
    if (!upstream.body) {
      throw new ResolveError('upstream', '封面下载失败');
    }

    reply.header('content-type', upstream.headers.get('content-type') ?? 'image/jpeg');
    reply.header('cache-control', 'public, max-age=3600');
    return reply.send(Readable.fromWeb(upstream.body));
  });

  app.get<{ Params: { jobId: string; variantId: string } }>(
    '/api/download/:jobId/:variantId',
    async (request, reply) => {
      const job = getJob(request.params.jobId);
      const variant = job.item.variants.find((item) => item.id === request.params.variantId);
      if (!variant) {
        throw new ResolveError('not_found', '没有这个版本');
      }

      await mkdir(TEMP_DIR, { recursive: true });
      const filePath = await downloadVariant(job.item, variant, { outputDir: TEMP_DIR });
      const info = await stat(filePath);
      await recordDownload({
        item: job.item,
        filename: basename(filePath),
        variant,
      }).catch(() => {});

      reply.header('content-type', mimeForExt(variant.ext));
      reply.header('content-length', info.size);
      reply.header('content-disposition', attachment(basename(filePath)));
      reply.header('cache-control', 'no-store');

      const stream = createReadStream(filePath);
      stream.on('close', () => {
        void rm(filePath, { force: true });
      });
      return reply.send(stream);
    },
  );

  app.get<{ Params: { jobId: string; imageId: string }; Querystring: { download?: string } }>(
    '/api/image/:jobId/:imageId',
    async (request, reply) => {
      const job = getJob(request.params.jobId);
      const image = job.item.images?.find((item) => item.id === request.params.imageId);
      if (!image) {
        throw new ResolveError('not_found', '没有这张图片');
      }

      const upstream = await fetchUpstream(image.url, {
        headers: image.headers,
        timeoutMs: 60_000,
      });
      if (!upstream.body) {
        throw new ResolveError('upstream', '图片下载失败');
      }

      const filename = `${sanitizeFilename(job.item.title, 'image')}-${image.id}.${image.ext}`;
      if (request.query.download === '1') {
        await recordDownload({
          item: job.item,
          filename,
          imageId: image.id,
          imageLabel: image.label,
          imageCount: job.item.images?.length,
        }).catch(() => {});
      }
      reply.header('content-type', upstream.headers.get('content-type') ?? mimeForExt(image.ext));
      reply.header(
        'content-disposition',
        `${request.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      reply.header('cache-control', 'no-store');
      return reply.send(Readable.fromWeb(upstream.body));
    },
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ResolveError) {
      const status =
        error.code === 'unsupported_url'
          ? 400
          : error.code === 'not_found'
            ? 404
            : error.code === 'login_required' || error.code === 'blocked'
              ? 403
              : error.code === 'ffmpeg_missing'
                ? 422
                : 502;
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'internal', message: '服务内部错误' } });
  });

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(TEMP_DIR, { recursive: true });
  await app.listen({ port, host });

  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    app,
    url,
    port: actualPort,
    close: async () => {
      clearInterval(jobCleanup);
      await app.close();
      await closeBrowser();
    },
  };
}
