const API = 'http://127.0.0.1:17890';

const STATUS_PLATFORMS = [
  {
    id: 'douyin',
    name: '抖音',
    test: (host) => host === 'douyin.com' || host.endsWith('.douyin.com'),
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    test: (host) =>
      host === 'bilibili.com' ||
      host.endsWith('.bilibili.com') ||
      host === 'b23.tv' ||
      host.endsWith('.b23.tv'),
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    test: (host) =>
      host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com') || host === 'xhslink.com',
  },
];

const statusElement = document.querySelector('#status');
const resultElement = document.querySelector('#result');
const platformElement = document.querySelector('#platform');

function detectPlatform(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return STATUS_PLATFORMS.find((platform) => platform.test(host));
  } catch {
    return undefined;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function setStatus(message, tone = '') {
  statusElement.innerHTML = message;
  statusElement.dataset.tone = tone;
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

function startDownload(path) {
  chrome.downloads.download({ url: `${API}${path}`, saveAs: false }, () => {
    const error = chrome.runtime.lastError;
    if (error) {
      setStatus(`下载失败：${escapeHtml(error.message)}`, 'error');
      return;
    }
    setStatus('已加入下载列表', 'ok');
  });
}

function bindDownloads(jobId) {
  for (const button of resultElement.querySelectorAll('[data-variant]')) {
    button.addEventListener('click', () => {
      if (button.dataset.disabled === '1') {
        setStatus('这个版本需要 ffmpeg 合并音视频，请先启动本地服务并安装 ffmpeg。', 'error');
        return;
      }
      startDownload(
        `/api/download/${encodeURIComponent(jobId)}/${encodeURIComponent(button.dataset.variant)}`,
      );
    });
  }

  for (const button of resultElement.querySelectorAll('[data-image]')) {
    button.addEventListener('click', () => {
      startDownload(
        `/api/image/${encodeURIComponent(jobId)}/${encodeURIComponent(button.dataset.image)}?download=1`,
      );
    });
  }
}

function render(item, jobId) {
  const cover = item.coverUrl
    ? `<img class="cover" src="${API}/api/cover/${encodeURIComponent(jobId)}" alt="" />`
    : '';
  const meta = [item.author, item.durationSec ? formatDuration(item.durationSec) : null]
    .filter(Boolean)
    .join(' · ');

  if (item.kind === 'images') {
    const images = (item.images ?? [])
      .map(
        (
          image,
        ) => `<button class="thumb" data-image="${escapeHtml(image.id)}" title="${escapeHtml(image.label ?? '下载图片')}">
          <img src="${API}/api/image/${encodeURIComponent(jobId)}/${encodeURIComponent(image.id)}" alt="" />
          <span class="arrow" aria-hidden="true">↓</span>
        </button>`,
      )
      .join('');

    resultElement.innerHTML = `
      <div class="item-head">${cover}<div class="item-meta"><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(meta)}</p></div></div>
      <p class="hint">共 ${item.images?.length ?? 0} 张图片，点击下载原图。</p>
      <div class="thumbs">${images}</div>
    `;
  } else {
    const variants = (item.variants ?? [])
      .map((variant) => {
        const disabled = Boolean(variant.requiresFfmpeg);
        const tags = [];
        if (item.platform === 'douyin') tags.push('无水印');
        if (variant.requiresFfmpeg) {
          tags.push(window.__mediaSaverHealth?.ffmpeg ? '音视频合并' : '需 ffmpeg');
        }
        return `<button class="variant" data-variant="${escapeHtml(variant.id)}" data-disabled="${disabled && !window.__mediaSaverHealth?.ffmpeg ? '1' : '0'}" ${disabled && !window.__mediaSaverHealth?.ffmpeg ? 'aria-disabled="true"' : ''}>
          <span>${escapeHtml(variant.label)}</span>
          <span class="tags">${tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}<span class="arrow" aria-hidden="true">↓</span></span>
        </button>`;
      })
      .join('');

    resultElement.innerHTML = `
      <div class="item-head">${cover}<div class="item-meta"><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(meta)}</p></div></div>
      ${item.platform === 'douyin' ? '<p class="hint">抖音网页端已不提供带水印版本。</p>' : ''}
      <div class="variants">${variants}</div>
    `;
  }

  resultElement.hidden = false;
  bindDownloads(jobId);
}

async function loadHealth() {
  try {
    const response = await fetch(`${API}/api/health`, { cache: 'no-store' });
    window.__mediaSaverHealth = await response.json();
  } catch {
    window.__mediaSaverHealth = { ffmpeg: false, browser: false };
  }
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    setStatus('无法读取当前页面地址，请刷新页面后重试。', 'error');
    return;
  }

  const platform = detectPlatform(tab.url);
  if (!platform) {
    setStatus('当前页面不是支持的作品页。打开抖音、小红书或 B 站的作品页后再试。', 'error');
    return;
  }

  platformElement.hidden = false;
  platformElement.className = `badge badge-${platform.id}`;
  platformElement.textContent = platform.name;
  setStatus('正在解析…');
  await loadHealth();

  try {
    const response = await fetch(`${API}/api/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: tab.url }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `请求失败（${response.status}）`);
    }
    render(data.item, data.jobId);
    setStatus('');
  } catch (error) {
    if (error instanceof TypeError) {
      setStatus('本地服务没有启动。请在项目目录运行 <code>pnpm web</code> 后重试。', 'error');
    } else {
      setStatus(escapeHtml(error instanceof Error ? error.message : String(error)), 'error');
    }
  }
}

void main();
