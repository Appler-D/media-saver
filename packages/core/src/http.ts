import { ResolveError } from './errors.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface RequestOptions {
  headers?: Record<string, string>;
  cookie?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  method?: string;
  redirect?: 'follow' | 'error' | 'manual';
}

export function buildHeaders(options: RequestOptions = {}): Headers {
  const headers = new Headers(options.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', DEFAULT_USER_AGENT);
  if (!headers.has('accept-language')) headers.set('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8');
  if (options.cookie && !headers.has('cookie')) headers.set('cookie', options.cookie);
  return headers;
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('请求超时')),
    options.timeoutMs ?? 15_000,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: buildHeaders(options),
      redirect: options.redirect ?? 'follow',
      signal,
    });
    if (!response.ok) {
      throw new ResolveError('upstream', `请求失败：HTTP ${response.status}`, { url });
    }
    return response;
  } catch (error) {
    if (error instanceof ResolveError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ResolveError('upstream', `请求失败：${message}`, { url, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, options: RequestOptions = {}): Promise<string> {
  const response = await request(url, options);
  return response.text();
}

export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { accept: 'application/json, text/plain, */*', ...options.headers },
  });
  return (await response.json()) as T;
}

/** 跟踪短链跳转，返回最终地址 */
export async function followRedirect(url: string, options: RequestOptions = {}): Promise<string> {
  const response = await request(url, { ...options, method: 'GET' });
  return response.url || url;
}
