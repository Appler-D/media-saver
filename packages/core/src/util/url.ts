/** 从分享文本里提取第一个链接，去掉中文标点带来的尾巴 */
export function extractUrl(input: string): string | undefined {
  const match = input.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match?.[0]) return undefined;
  return match[0].replace(/[),.;!?，。；！？、]+$/u, '');
}

export function parseUrl(input: string): URL | undefined {
  const raw = extractUrl(input) ?? input.trim();
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
