export type ResolveErrorCode =
  | 'unsupported_url'
  | 'not_found'
  | 'login_required'
  | 'blocked'
  | 'parse_failed'
  | 'upstream'
  | 'download_failed'
  | 'ffmpeg_missing';

export interface ResolveErrorOptions {
  cause?: unknown;
  url?: string;
}

export class ResolveError extends Error {
  readonly code: ResolveErrorCode;
  readonly url?: string;

  constructor(code: ResolveErrorCode, message: string, options: ResolveErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'ResolveError';
    this.code = code;
    this.url = options.url;
  }
}
