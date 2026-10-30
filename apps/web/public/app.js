const form = document.querySelector('#resolve-form');
const input = document.querySelector('#url');
const pasteButton = document.querySelector('#paste');
const statusElement = document.querySelector('#status');
const resultElement = document.querySelector('#result');
const submitButton = form.querySelector('button[type="submit"]');
const footerState = document.querySelector('#footer-state');
const downloadFrame = document.querySelector('#download-frame');

const PLATFORM_NAMES = {
  douyin: '抖音',
  bilibili: '哔哩哔哩',
  xiaohongshu: '小红书',
};
const COOKIE_NAMES = {
  douyin: '抖音',
  bilibili: 'B站',
  xiaohongshu: '小红书',
};

let health = { ffmpeg: false, browser: false, cookies: {} };
let busy = false;

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function setStatus(message, tone = '') {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `请求失败（${response.status}）`);
  }
  return data;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function renderVariants(item) {
  const variants = item.variants ?? [];
  const needsFfmpeg = variants.some((variant) => variant.requiresFfmpeg);
  const hints = [];

  if (item.platform === 'douyin') {
    hints.push('<p class="hint">抖音网页端已不提供带水印版本，这里是无水印源。</p>');
  }
  if (needsFfmpeg && !health.ffmpeg) {
    hints.push(
      '<p class="hint warn">未检测到 ffmpeg：高清 DASH 版本需要先安装 ffmpeg，或选择“单文件”版本。</p>',
    );
  }

  const rows = variants
    .map((variant) => {
      const disabled = Boolean(variant.requiresFfmpeg) && !health.ffmpeg;
      const tags = [];
      if (item.platform === 'douyin') tags.push('无水印');
      if (variant.requiresFfmpeg) tags.push(health.ffmpeg ? '音视频合并' : '需要 ffmpeg');

      return `<button type="button" class="variant" data-variant="${escapeHtml(variant.id)}" data-disabled="${disabled ? '1' : '0'}" ${disabled ? 'aria-disabled="true"' : ''}>
        <span class="variant-label">${escapeHtml(variant.label)}</span>
        <span class="variant-side">${tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}<span class="arrow" aria-hidden="true">↓</span></span>
      </button>`;
    })
    .join('');

  return `${hints.join('')}<div class="variants">${rows}</div>`;
}

function renderImages(item, jobId) {
  const images = item.images ?? [];
  const thumbs = images
    .map(
      (
        image,
      ) => `<a class="thumb" href="/api/image/${encodeURIComponent(jobId)}/${encodeURIComponent(image.id)}?download=1" title="${escapeHtml(image.label ?? '下载图片')}">
        <img src="/api/image/${encodeURIComponent(jobId)}/${encodeURIComponent(image.id)}" alt="${escapeHtml(image.label ?? '')}" loading="lazy" />
      </a>`,
    )
    .join('');

  return `<p class="hint">共 ${images.length} 张图片，点击下载原图。</p><div class="thumbs">${thumbs}</div>`;
}

function bindVariants(jobId) {
  for (const button of resultElement.querySelectorAll('.variant')) {
    button.addEventListener('click', () => {
      if (button.dataset.disabled === '1') {
        setStatus('这个版本需要 ffmpeg 合并音视频，请先安装 ffmpeg，或选择单文件版本。', 'error');
        return;
      }
      if (button.dataset.busy === '1') return;

      button.dataset.busy = '1';
      const label = button.querySelector('.variant-label');
      const original = label.textContent;
      label.textContent = '准备下载…';
      downloadFrame.src = `/api/download/${encodeURIComponent(jobId)}/${encodeURIComponent(button.dataset.variant)}`;
      setStatus('正在准备文件，稍后会出现在浏览器下载列表中。', 'ok');

      setTimeout(() => {
        label.textContent = original;
        button.dataset.busy = '0';
      }, 4000);
    });
  }
}

function render(item, jobId) {
  const cover = item.coverUrl
    ? `<img class="cover" src="/api/cover/${encodeURIComponent(jobId)}" alt="" loading="lazy" />`
    : '<div class="cover cover-empty"></div>';
  const meta = [item.author, item.durationSec ? formatDuration(item.durationSec) : null]
    .filter(Boolean)
    .join(' · ');

  resultElement.innerHTML = `
    <article class="card">
      <header class="card-head">
        ${cover}
        <div class="card-meta">
          <div class="badges">
            <span class="badge badge-${escapeHtml(item.platform)}">${escapeHtml(PLATFORM_NAMES[item.platform] ?? item.platformName)}</span>
            <span class="badge ghost">${item.kind === 'images' ? `${item.images?.length ?? 0} 张图片` : '视频'}</span>
          </div>
          <h2>${escapeHtml(item.title)}</h2>
          <p class="meta">${escapeHtml(meta)}</p>
        </div>
      </header>
      ${item.kind === 'images' ? renderImages(item, jobId) : renderVariants(item)}
    </article>
  `;

  const coverImage = resultElement.querySelector('.cover');
  coverImage?.addEventListener('error', () => coverImage.remove(), { once: true });
  bindVariants(jobId);
}

async function loadHealth() {
  try {
    health = await api('/api/health');
  } catch {
    setStatus('无法连接本地服务，请确认终端里的服务仍在运行。', 'error');
  }

  const parts = [
    health.ffmpeg ? 'ffmpeg 已就绪' : 'ffmpeg 未安装',
    health.browser ? '浏览器已就绪' : '未找到 Chrome/Edge',
  ];
  const cookies = Object.entries(COOKIE_NAMES)
    .filter(([id]) => health.cookies?.[id])
    .map(([, name]) => name);
  parts.push(cookies.length ? `Cookie：${cookies.join('、')}` : '未配置 Cookie');
  footerState.textContent = parts.join(' · ');
  footerState.dataset.warn = String(!health.ffmpeg || !health.browser);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url || busy) return;

  busy = true;
  submitButton.disabled = true;
  submitButton.textContent = '解析中…';
  resultElement.hidden = true;
  setStatus('正在解析链接…');

  const slowTimer = setTimeout(() => {
    if (busy) setStatus('部分平台需要启动本机浏览器，首次解析可能多等几秒…');
  }, 4500);

  try {
    const data = await api('/api/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    render(data.item, data.jobId);
    resultElement.hidden = false;
    setStatus('');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    clearTimeout(slowTimer);
    busy = false;
    submitButton.disabled = false;
    submitButton.textContent = '解析';
  }
});

pasteButton.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim()) {
      input.value = text.trim();
      input.focus();
    }
  } catch {
    input.focus();
    setStatus('浏览器没有授权读取剪贴板，请手动粘贴。', 'error');
  }
});

const sharedUrl = new URLSearchParams(location.search).get('url');
if (sharedUrl) {
  input.value = sharedUrl;
  form.requestSubmit();
}

void loadHealth();
