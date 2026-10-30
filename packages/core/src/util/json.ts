function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/** 页面内嵌 JSON 常带裸 undefined，解析前替换为 null（字符串内的不动） */
function replaceBareUndefined(raw: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] as string;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (
      raw.startsWith('undefined', index) &&
      !isIdentifierChar(raw[index - 1]) &&
      !isIdentifierChar(raw[index + 'undefined'.length])
    ) {
      output += 'null';
      index += 'undefined'.length - 1;
      continue;
    }

    output += char;
  }

  return output;
}

export function parseLooseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(replaceBareUndefined(raw));
  }
}

/** 从 start 处的 `{` 开始截取配平的 JSON 对象 */
export function sliceBalancedJson(text: string, start: number): string | undefined {
  if (text[start] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return undefined;
}

/** 找到 marker 之后的第一段 JSON 对象并解析 */
export function extractJsonAfter(text: string, marker: string): unknown | undefined {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return undefined;
  const start = text.indexOf('{', markerIndex + marker.length);
  if (start === -1) return undefined;
  const raw = sliceBalancedJson(text, start);
  if (!raw) return undefined;
  try {
    return parseLooseJson(raw);
  } catch {
    return undefined;
  }
}

/** 页面内 `<script id="RENDER_DATA">` 这类整体 URL 编码的 JSON */
export function extractEncodedJson(html: string, pattern: RegExp): unknown | undefined {
  const match = pattern.exec(html);
  if (!match?.[1]) return undefined;
  try {
    return parseLooseJson(decodeURIComponent(match[1]));
  } catch {
    return undefined;
  }
}
