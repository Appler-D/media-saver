import { describe, expect, it } from 'vitest';
import {
  extractJsonAfter,
  extractUrl,
  findAdapter,
  parseUrl,
  sanitizeFilename,
  variantFilename,
} from '../src/index.js';
import { signWbiParams } from '../src/platforms/bilibili.js';
import type { MediaItem, MediaVariant } from '../src/types.js';

const longItem = { title: 'x'.repeat(240) } as MediaItem;
const variant = (quality: string, watermark: 'none' | 'watermarked'): MediaVariant =>
  ({ quality, watermark }) as MediaVariant;

describe('url helpers', () => {
  it('extracts a URL from share text', () => {
    expect(extractUrl('复制打开抖音 https://v.douyin.com/abc123/ 看看')).toBe(
      'https://v.douyin.com/abc123/',
    );
  });

  it('strips trailing punctuation', () => {
    expect(extractUrl('看这个 https://www.bilibili.com/video/BV1GJ411x7h7，')).toBe(
      'https://www.bilibili.com/video/BV1GJ411x7h7',
    );
  });

  it('rejects non-http input', () => {
    expect(parseUrl('javascript:alert(1)')).toBeUndefined();
    expect(parseUrl('不是链接')).toBeUndefined();
  });
});

describe('platform registry', () => {
  it.each([
    ['https://www.douyin.com/video/7502750250231450891', 'douyin'],
    ['https://www.bilibili.com/video/BV1GJ411x7h7', 'bilibili'],
    ['https://www.xiaohongshu.com/explore/691eb5fc000000001e0381a5', 'xiaohongshu'],
  ])('matches %s', (url, id) => {
    expect(findAdapter(url)?.id).toBe(id);
  });

  it('returns undefined for unsupported hosts', () => {
    expect(findAdapter('https://example.com')).toBeUndefined();
  });
});

describe('embedded json extraction', () => {
  it('parses undefined and keeps the string value intact', () => {
    const html = 'window.X = {"a":undefined,"b":"undefined","c":[1,{"d":2}]};';
    expect(extractJsonAfter(html, 'window.X')).toEqual({
      a: null,
      b: 'undefined',
      c: [1, { d: 2 }],
    });
  });

  it('handles braces inside strings', () => {
    const html = 'window.X = {"a":"{not json}","b":"}","c":1};';
    expect(extractJsonAfter(html, 'window.X')).toEqual({ a: '{not json}', b: '}', c: 1 });
  });
});

describe('filenames', () => {
  it('removes Windows-invalid characters', () => {
    expect(sanitizeFilename('a/b:c*?"<>| ')).toBe('a b c');
  });

  it('keeps the quality suffix for long titles', () => {
    const name = variantFilename(longItem, variant('1080p', 'none'));
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('-1080p-无水印')).toBe(true);
  });

  it('uses the watermarked suffix', () => {
    expect(
      variantFilename(longItem, variant('watermarked', 'watermarked')).endsWith('-带水印'),
    ).toBe(true);
  });
});

describe('bilibili wbi signing', () => {
  const imgKey = '7cd084941338484aae1ad9425b84077c';
  const subKey = '4932caff0ff746eab6f01bf08b70ac45';
  const params = { bvid: 'BV1GJ411x7h7', cid: '137649199', qn: '80', fnval: '16' };
  const query = signWbiParams(params, imgKey, subKey, 1_700_000_000);

  it('is deterministic for the same inputs', () => {
    expect(query).toBe(signWbiParams(params, imgKey, subKey, 1_700_000_000));
  });

  it('contains wts and a 32-character w_rid', () => {
    expect(query).toContain('wts=1700000000');
    expect(query).toMatch(/w_rid=[0-9a-f]{32}$/);
  });
});
