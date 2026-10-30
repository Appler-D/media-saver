const form = document.querySelector('#resolve-form');
const input = document.querySelector('#url');
const pasteButton = document.querySelector('#paste');
const statusElement = document.querySelector('#status');
const resultElement = document.querySelector('#result');
const submitButton = form.querySelector('button[type="submit"]');
const footerState = document.querySelector('#footer-state');
const downloadFrame = document.querySelector('#download-frame');
const historyToggle = document.querySelector('#history-toggle');
const historySection = document.querySelector('#history');
const historyList = document.querySelector('#history-list');
const historyClear = document.querySelector('#history-clear');
const historyClose = document.querySelector('#history-close');

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

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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

function renderHistory(items) {
  if (items.length === 0) {
    historyList.innerHTML = '<p class="history-empty">还没有下载记录。</p>';
    return;
  }

  historyList.innerHTML = items
    .map((entry) => {
      const platform = PLATFORM_NAMES[entry.platform] ?? entry.platformName;
      const kind = entry.kind === 'images' ? `${entry.imageCount ?? 0} 张图片` : '视频';
      const meta = [entry.author, formatHistoryTime(entry.lastDownloadedAt)]
        .filter(Boolean)
        .join(' · ');
      const downloads = (entry.downloads ?? [])
        .map(
          (download) =>
            `<span class="history-download" title="${escapeHtml(download.filename ?? '')}">${escapeHtml(download.label ?? download.filename)}</span>`,
        )
        .join('');

      return `<article class="history-item">
        <div class="history-main">
          <div class="badges">
            <span class="badge badge-${escapeHtml(entry.platform)}">${escapeHtml(platform)}</span>
            <span class="badge ghost">${escapeHtml(kind)}</span>
          </div>
          <h3>${escapeHtml(entry.title)}</h3>
          <p class="history-meta">${escapeHtml(meta)}</p>
          <div class="history-downloads">${downloads}</div>
        </div>
        <div class="history-buttons">
          <button type="button" class="ghost small" data-action="resolve" data-url="${escapeHtml(entry.pageUrl)}">重新解析</button>
          <button type="button" class="ghost small" data-action="open" data-url="${escapeHtml(entry.pageUrl)}">打开作品页</button>
          <button type="button" class="ghost small" data-action="delete" data-id="${escapeHtml(entry.id)}">删除</button>
        </div>
      </article>`;
    })
    .join('');
}

async function loadHistory() {
  historyList.innerHTML = '<p class="history-empty">正在读取历史…</p>';
  try {
    const data = await api('/api/history');
    renderHistory(data.items ?? []);
  } catch (error) {
    historyList.innerHTML = `<p class="history-empty">${escapeHtml(
      error instanceof Error ? error.message : '历史读取失败',
    )}</p>`;
  }
}

function setHistoryOpen(open) {
  historySection.hidden = !open;
  historyToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    void loadHistory();
    historySection.querySelector('h2')?.focus();
  }
}

historyToggle.addEventListener('click', () => {
  setHistoryOpen(historySection.hidden);
});

historyClose.addEventListener('click', () => {
  setHistoryOpen(false);
  historyToggle.focus();
});

historyClear.addEventListener('click', async () => {
  if (!window.confirm('清空所有下载历史？')) return;
  try {
    await api('/api/history', { method: 'DELETE' });
    await loadHistory();
    setStatus('历史已清空', 'ok');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

historyList.addEventListener('click', (event) => {
  const target =
    event.target instanceof Element ? event.target.closest('button[data-action]') : null;
  if (!target) return;

  const action = target.dataset.action;
  if (action === 'resolve') {
    const url = target.dataset.url;
    if (!url) return;
    input.value = url;
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    form.requestSubmit();
    return;
  }

  if (action === 'open') {
    const url = target.dataset.url;
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }

  if (action === 'delete') {
    const id = target.dataset.id;
    if (!id) return;
    void (async () => {
      try {
        await api(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadHistory();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    })();
  }
});

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
