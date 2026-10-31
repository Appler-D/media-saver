const form = document.querySelector('#resolve-form');
const input = document.querySelector('#url');
const pasteButton = document.querySelector('#paste');
const statusElement = document.querySelector('#status');
const resultElement = document.querySelector('#result');
const resultList = document.querySelector('#result-list');
const batchBar = document.querySelector('#batch-bar');
const batchSummary = document.querySelector('#batch-summary');
const batchDownload = document.querySelector('#batch-download');
const submitButton = form.querySelector('button[type="submit"]');
const footerState = document.querySelector('#footer-state');
const platformSummary = document.querySelector('#platform-summary');
const platformsToggle = document.querySelector('#platforms-toggle');
const platformsSection = document.querySelector('#platforms');
const platformList = document.querySelector('#platform-list');
const platformSave = document.querySelector('#platforms-save');
const platformClose = document.querySelector('#platforms-close');
const platformMessage = document.querySelector('#platform-message');
const importFileButton = document.querySelector('#import-file');
const fileInput = document.querySelector('#file-input');
const importPanel = document.querySelector('#import-panel');
const importNote = document.querySelector('#import-note');
const importList = document.querySelector('#import-list');
const importCount = document.querySelector('#import-count');
const importToggle = document.querySelector('#import-toggle');
const importParse = document.querySelector('#import-parse');
const importClear = document.querySelector('#import-clear');
const historyToggle = document.querySelector('#history-toggle');
const historySection = document.querySelector('#history');
const historyList = document.querySelector('#history-list');
const historyExport = document.querySelector('#history-export');
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

const MAX_BATCH = 20;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;!?，。；！？、]+$/u;

let health = { ffmpeg: false, browser: false, cookies: {} };
let platforms = [];
let busy = false;
let batchBusy = false;
let resolvedItems = [];

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

function extractUrls(value) {
  const urls = [];
  const seen = new Set();
  for (const match of value.match(URL_PATTERN) ?? []) {
    const url = match.replace(TRAILING_URL_PUNCTUATION, '');
    const key = url.replace(/\/+$/, '');
    if (!url || seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

function isVideo(entry) {
  return entry.item.kind === 'video' && (entry.item.variants?.length ?? 0) > 0;
}

function videoEntries() {
  return resolvedItems.filter(isVideo);
}

function defaultVariant(item) {
  const variants = item.variants ?? [];
  if (variants.length === 0) return undefined;
  if (health.ffmpeg) return variants[0];
  return variants.find((variant) => !variant.requiresFfmpeg);
}

function clearResults() {
  resolvedItems = [];
  resultList.innerHTML = '';
  resultElement.hidden = true;
  updateBatchBar();
}

function updateBatchBar() {
  const videos = videoEntries();
  batchBar.hidden = videos.length < 2;
  batchSummary.textContent = videos.length
    ? `${videos.length} 个视频 · 优先使用每个视频的最高可用清晰度`
    : '';
  batchDownload.disabled = batchBusy || busy || videos.length === 0;
}

function startFrameDownload(path) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = '下载文件';
  frame.src = path;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 120_000);
}

function startDownload(jobId, variantId) {
  startFrameDownload(`/api/download/${encodeURIComponent(jobId)}/${encodeURIComponent(variantId)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      ) => `<a class="thumb" href="/api/image/${encodeURIComponent(jobId)}/${encodeURIComponent(image.id)}?download=1&format=jpg" title="${escapeHtml(image.label ?? '下载图片')}">
        <img src="/api/image/${encodeURIComponent(jobId)}/${encodeURIComponent(image.id)}" alt="${escapeHtml(image.label ?? '')}" loading="lazy" />
      </a>`,
    )
    .join('');

  return `<p class="hint">共 ${images.length} 张图片，点击下载 JPG。</p><div class="thumbs">${thumbs}</div>`;
}

function bindVariants(jobId, card) {
  for (const button of card.querySelectorAll('.variant')) {
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
      startDownload(jobId, button.dataset.variant);
      setStatus('正在准备文件，稍后会出现在浏览器下载列表中。', 'ok');

      setTimeout(() => {
        label.textContent = original;
        button.dataset.busy = '0';
      }, 4000);
    });
  }
}

function cardHtml(item, jobId) {
  const cover = item.coverUrl
    ? `<img class="cover" src="/api/cover/${encodeURIComponent(jobId)}" alt="" loading="lazy" />`
    : '<div class="cover cover-empty"></div>';
  const meta = [item.author, item.durationSec ? formatDuration(item.durationSec) : null]
    .filter(Boolean)
    .join(' · ');

  return `
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
}

function addResult(item, jobId) {
  resultList.insertAdjacentHTML('beforeend', cardHtml(item, jobId));
  const card = resultList.lastElementChild;
  if (!card) return;

  const coverImage = card.querySelector('.cover');
  coverImage?.addEventListener('error', () => coverImage.remove(), { once: true });
  bindVariants(jobId, card);
  resolvedItems.push({ jobId, item });
  resultElement.hidden = false;
  updateBatchBar();
}

function addResultError(url, message) {
  resultList.insertAdjacentHTML(
    'beforeend',
    `<article class="card error-card">
      <div class="badges"><span class="badge ghost">解析失败</span></div>
      <h2>无法解析这个链接</h2>
      <p class="error-url">${escapeHtml(url)}</p>
      <p class="hint warn">${escapeHtml(message)}</p>
    </article>`,
  );
  resultElement.hidden = false;
}

batchDownload.addEventListener('click', async () => {
  if (batchBusy || busy) return;
  const videos = videoEntries();
  if (videos.length < 2) return;

  batchBusy = true;
  batchDownload.disabled = true;
  submitButton.disabled = true;
  batchDownload.textContent = '正在发起…';

  let started = 0;
  let skipped = 0;
  try {
    for (const [index, entry] of videos.entries()) {
      const variant = defaultVariant(entry.item);
      if (!variant) {
        skipped += 1;
        continue;
      }

      startDownload(entry.jobId, variant.id);
      started += 1;
      setStatus(`正在发起下载 ${index + 1}/${videos.length}…`, 'ok');
      if (index < videos.length - 1) await sleep(1200);
    }

    if (started) {
      const skippedText = skipped ? `，跳过 ${skipped} 个（没有可用版本）` : '';
      setStatus(
        `已发起 ${started} 个下载${skippedText}。浏览器如提示多文件下载，请选择允许。`,
        'ok',
      );
    } else {
      setStatus(
        skipped ? `没有可批量下载的视频：${skipped} 个缺少可用版本` : '没有可批量下载的视频',
        'error',
      );
    }
  } finally {
    batchBusy = false;
    submitButton.disabled = false;
    batchDownload.textContent = '全部下载';
    updateBatchBar();
  }
});

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

function setPlatformMessage(message, tone = '') {
  platformMessage.textContent = message;
  platformMessage.dataset.tone = tone;
}

function renderPlatforms() {
  platformList.innerHTML = platforms
    .map(
      (platform) => `<label class="platform-option">
        <input type="checkbox" value="${escapeHtml(platform.id)}" ${platform.enabled ? 'checked' : ''} />
        <span>${escapeHtml(platform.name)}</span>
      </label>`,
    )
    .join('');

  const names = platforms.filter((platform) => platform.enabled).map((platform) => platform.name);
  platformSummary.textContent = names.length ? names.join(' · ') : '尚未启用平台';
}

async function loadPlatforms() {
  try {
    const data = await api('/api/platforms');
    platforms = Array.isArray(data.platforms) ? data.platforms : [];
    renderPlatforms();
  } catch {
    // 页面仍可打开；保存时会再次提示服务错误
  }
}

function setPlatformsOpen(open) {
  platformsSection.hidden = !open;
  platformsToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    setPlatformMessage('');
    renderPlatforms();
    platformsSection.querySelector('h2')?.focus();
  }
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

platformsToggle.addEventListener('click', () => {
  const open = platformsSection.hidden;
  if (open) setHistoryOpen(false);
  setPlatformsOpen(open);
  if (!open) platformsToggle.focus();
});

platformClose.addEventListener('click', () => {
  setPlatformsOpen(false);
  platformsToggle.focus();
});

platformSave.addEventListener('click', async () => {
  const enabled = [...platformList.querySelectorAll('input[type="checkbox"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
  if (enabled.length === 0) {
    setPlatformMessage('至少保留一个平台', 'error');
    return;
  }

  platformSave.disabled = true;
  setPlatformMessage('正在保存…');
  try {
    const data = await api('/api/platforms', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    platforms = Array.isArray(data.platforms) ? data.platforms : platforms;
    renderPlatforms();
    setPlatformMessage('已保存', 'ok');
    setStatus('平台设置已保存', 'ok');
  } catch (error) {
    setPlatformMessage(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    platformSave.disabled = false;
  }
});

historyToggle.addEventListener('click', () => {
  setPlatformsOpen(false);
  setHistoryOpen(historySection.hidden);
});

historyClose.addEventListener('click', () => {
  setHistoryOpen(false);
  historyToggle.focus();
});

historyExport.addEventListener('click', () => {
  startFrameDownload('/api/history/export');
  setStatus('正在导出历史…', 'ok');
  historyExport.disabled = true;
  setTimeout(() => {
    historyExport.disabled = false;
  }, 2000);
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
    resizeInput();
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    form.requestSubmit();
    return;
  }

  if (action === 'open') {
    const url = target.dataset.url;
    if (!url) return;
    const opened = window.open(url, 'media-saver-source');
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        // 跨域窗口可能不允许设置 opener
      }
    }
    target.disabled = true;
    setTimeout(() => {
      target.disabled = false;
    }, 2000);
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

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = input.value.trim();
  if (!raw || busy || batchBusy) return;

  const urls = extractUrls(raw);
  if (urls.length === 0) urls.push(raw);
  if (urls.length > MAX_BATCH) {
    setStatus(`一次最多解析 ${MAX_BATCH} 个链接，请分批粘贴。`, 'error');
    return;
  }
  void resolveUrls(urls);
});

async function resolveUrls(urls) {
  if (busy || batchBusy || urls.length === 0) return;
  if (urls.length > MAX_BATCH) {
    setStatus(`一次最多解析 ${MAX_BATCH} 个链接，请分批粘贴。`, 'error');
    return;
  }

  busy = true;
  submitButton.disabled = true;
  updateImportSelection();
  submitButton.textContent = urls.length > 1 ? '批量解析中…' : '解析中…';
  clearResults();
  setStatus(urls.length > 1 ? `正在解析 1/${urls.length}…` : '正在解析链接…');

  const slowTimer = setTimeout(() => {
    if (busy) setStatus('部分平台需要启动本机浏览器，首次解析可能多等几秒…');
  }, 4500);

  let succeeded = 0;
  let failed = 0;
  try {
    for (const [index, url] of urls.entries()) {
      if (urls.length > 1) setStatus(`正在解析 ${index + 1}/${urls.length}…`);
      try {
        const data = await api('/api/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        addResult(data.item, data.jobId);
        succeeded += 1;
      } catch (error) {
        addResultError(url, error instanceof Error ? error.message : String(error));
        failed += 1;
      }
    }

    if (urls.length === 1) {
      if (succeeded === 0) setStatus('解析失败', 'error');
      else setStatus('');
    } else {
      const parts = [`已解析 ${succeeded} 个链接`];
      if (failed > 0) parts.push(`${failed} 个失败`);
      const videos = videoEntries().length;
      if (videos > 1) parts.push(`可批量下载 ${videos} 个视频`);
      setStatus(parts.join('，'), failed > 0 ? 'error' : 'ok');
    }
  } finally {
    clearTimeout(slowTimer);
    busy = false;
    submitButton.disabled = false;
    submitButton.textContent = '解析';
    updateBatchBar();
    updateImportSelection();
    resizeInput();
  }
}

function selectedImportUrls() {
  return [...importList.querySelectorAll('input[type="checkbox"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function updateImportSelection() {
  const selected = selectedImportUrls().length;
  const total = importList.querySelectorAll('input[type="checkbox"]').length;
  importCount.textContent = total ? `已选 ${selected} / ${total}` : '';
  importCount.dataset.tone = selected ? '' : 'error';
  importToggle.textContent = selected > 0 ? '取消全选' : '全选';
  importParse.disabled = selected === 0 || busy || batchBusy;
}

function renderImportLinks(urls, sourceName) {
  importNote.textContent =
    urls.length > MAX_BATCH
      ? `从 ${sourceName} 识别到 ${urls.length} 个链接，已默认勾选前 ${MAX_BATCH} 个；一次最多解析 ${MAX_BATCH} 个。`
      : `从 ${sourceName} 识别到 ${urls.length} 个链接，勾选后点“解析选中”。`;
  importList.innerHTML = urls
    .map(
      (url, index) => `<label class="link-option">
        <input type="checkbox" value="${escapeHtml(url)}" ${index < MAX_BATCH ? 'checked' : ''} />
        <span class="link-url">${escapeHtml(url)}</span>
      </label>`,
    )
    .join('');
  importPanel.hidden = false;
  updateImportSelection();
}

async function loadLinkFile(file) {
  if (busy || batchBusy) {
    setStatus('请等待当前任务完成后再导入文件。', 'error');
    return;
  }
  const isTextFile =
    file.type.startsWith('text/') || /\.(txt|md|markdown|text|log|csv)$/i.test(file.name);
  if (!isTextFile) {
    setStatus('只支持 .txt / .md 等文本文件。', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setStatus('文件过大，请控制在 2MB 以内。', 'error');
    return;
  }

  setStatus(`正在读取 ${file.name}…`);
  try {
    const text = await file.text();
    const urls = extractUrls(text);
    if (urls.length === 0) {
      setStatus('文件里没有找到链接。', 'error');
      return;
    }
    clearResults();
    renderImportLinks(urls, file.name);
    setStatus(`已识别 ${urls.length} 个链接，勾选后点“解析选中”。`, 'ok');
  } catch (error) {
    setStatus(`读取文件失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

importFileButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void loadLinkFile(file);
});

importList.addEventListener('change', (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input) return;
  if (selectedImportUrls().length > MAX_BATCH) {
    input.checked = false;
    setStatus(`一次最多选择 ${MAX_BATCH} 个链接。`, 'error');
  }
  updateImportSelection();
});

importToggle.addEventListener('click', () => {
  const boxes = [...importList.querySelectorAll('input[type="checkbox"]')];
  const hasSelected = boxes.some((box) => box.checked);
  boxes.forEach((box, index) => {
    box.checked = hasSelected ? false : index < MAX_BATCH;
  });
  updateImportSelection();
});

importParse.addEventListener('click', () => {
  const selected = selectedImportUrls();
  if (selected.length === 0) {
    importCount.textContent = '至少选择一个链接';
    importCount.dataset.tone = 'error';
    return;
  }
  if (busy || batchBusy) return;

  input.value = selected.join('\n');
  resizeInput();
  setStatus(`正在解析选中的 ${selected.length} 个链接…`);
  void resolveUrls(selected);
});

importClear.addEventListener('click', () => {
  importPanel.hidden = true;
  importList.innerHTML = '';
  importNote.textContent = '';
  importCount.textContent = '';
  importCount.dataset.tone = '';
  importFileButton.focus();
});

form.addEventListener('dragover', (event) => {
  event.preventDefault();
  form.classList.add('dragging');
});
form.addEventListener('dragleave', () => form.classList.remove('dragging'));
form.addEventListener('drop', (event) => {
  event.preventDefault();
  form.classList.remove('dragging');
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadLinkFile(file);
});

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
}

input.addEventListener('input', resizeInput);
window.addEventListener('resize', resizeInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
});

pasteButton.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim()) {
      input.value = text.trim();
      resizeInput();
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
  resizeInput();
  form.requestSubmit();
}

resizeInput();
void loadHealth();
void loadPlatforms();
