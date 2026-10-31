import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { type MediaServer, startMediaServer } from '@media-saver/web/app';
import {
  BrowserWindow,
  dialog,
  app as electronApp,
  Menu,
  type OpenDialogOptions,
  session,
  shell,
} from 'electron';

const BASE_URL = 'http://127.0.0.1:17890';
const APP_ID = 'cn.appler.mediasaver';

let mainWindow: BrowserWindow | undefined;
let mediaServer: MediaServer | undefined;
let appUrl = BASE_URL;
let quitting = false;
let lastExternalOpen = { url: '', at: 0 };

function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const base = path.slice(0, path.length - ext.length);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

let downloadDirectoryOverride: string | undefined;

function settingsPath(): string {
  return join(electronApp.getPath('userData'), 'settings.json');
}

function loadSettings(): void {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      downloadDir?: unknown;
    };
    if (typeof parsed.downloadDir === 'string' && parsed.downloadDir.trim()) {
      downloadDirectoryOverride = parsed.downloadDir;
    }
  } catch {
    downloadDirectoryOverride = undefined;
  }
}

function saveSettings(): void {
  mkdirSync(electronApp.getPath('userData'), { recursive: true });
  writeFileSync(
    settingsPath(),
    JSON.stringify({ downloadDir: downloadDirectoryOverride ?? null }, null, 2),
    'utf8',
  );
}

function downloadDir(): string {
  return downloadDirectoryOverride ?? join(electronApp.getPath('downloads'), 'MediaSaver');
}

function todayDir(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return join(downloadDir(), date);
}

function openDownloads(): void {
  const directory = downloadDir();
  mkdirSync(directory, { recursive: true });
  void shell.openPath(directory);
}

async function chooseDownloadDir(): Promise<void> {
  const options: OpenDialogOptions = {
    title: '选择下载文件夹',
    defaultPath: downloadDir(),
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return;

  try {
    mkdirSync(selected, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('无法使用该文件夹', message);
    return;
  }

  downloadDirectoryOverride = selected;
  saveSettings();
  if (mainWindow) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'MediaSaver',
      message: '下载文件夹已更改',
      detail: selected,
    });
  }
}

async function existingServer(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(1200),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function setupMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '更改下载文件夹…', click: () => void chooseDownloadDir() },
          { label: '打开下载文件夹', click: openDownloads },
          { type: 'separator' },
          { label: '退出', role: 'quit' },
        ],
      },
      { label: '编辑', role: 'editMenu' },
      {
        label: '视图',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '项目主页',
            click: () => {
              void shell.openExternal('https://github.com/Appler-D/media-saver');
            },
          },
        ],
      },
    ]),
  );
}

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'MediaSaver',
    backgroundColor: '#f6f4ef',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) {
      const now = Date.now();
      if (target !== lastExternalOpen.url || now - lastExternalOpen.at > 2500) {
        lastExternalOpen = { url: target, at: now };
        void shell.openExternal(target);
      }
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:/i.test(target)) void shell.openExternal(target);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  void mainWindow.loadURL(url);
}

async function start(): Promise<void> {
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  process.env.FFMPEG_PATH = electronApp.isPackaged
    ? join(process.resourcesPath, ffmpegName)
    : join(__dirname, '..', 'resources', ffmpegName);

  loadSettings();
  const directory = downloadDir();
  mkdirSync(directory, { recursive: true });
  console.log('[desktop] download directory:', directory);

  session.defaultSession.on('will-download', (_event, item) => {
    const targetDirectory = todayDir();
    mkdirSync(targetDirectory, { recursive: true });
    const filename = basename(item.getFilename()) || 'download';
    const target = uniquePath(join(targetDirectory, filename));
    console.log('[desktop] download:', item.getURL(), '->', target);
    item.setSavePath(target);
    item.once('done', (_doneEvent, state) => {
      console.log('[desktop] download done:', state, target);
    });
  });

  if (await existingServer()) {
    appUrl = BASE_URL;
  } else {
    const publicDir = electronApp.isPackaged
      ? join(process.resourcesPath, 'web')
      : join(__dirname, '..', '..', 'web', 'public');
    mediaServer = await startMediaServer({ publicDir, port: 17890 });
    appUrl = mediaServer.url;
  }

  setupMenu();
  createWindow(appUrl);
}

electronApp.setName('MediaSaver');
if (process.platform === 'win32') electronApp.setAppUserModelId(APP_ID);

const debugPort = process.env.MEDIA_SAVER_DEBUG_PORT?.trim();
if (debugPort) {
  electronApp.commandLine.appendSwitch('remote-debugging-port', debugPort);
}

const hasLock = electronApp.requestSingleInstanceLock();
if (!hasLock) {
  electronApp.quit();
} else {
  electronApp.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(appUrl);
  });

  void electronApp
    .whenReady()
    .then(start)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        'MediaSaver 启动失败',
        `${message}\n\n如果 17890 端口被其他程序占用，请关闭该程序后重试。`,
      );
      electronApp.quit();
    });
}

electronApp.on('window-all-closed', () => {
  electronApp.quit();
});

electronApp.on('will-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (async () => {
    await mediaServer?.close().catch(() => {});
    electronApp.quit();
  })();
});
