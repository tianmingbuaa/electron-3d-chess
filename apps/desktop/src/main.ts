import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createChessServer, type ChessServer } from '@nocturne/chess-server';

const DEV_RENDERER_URL = process.env.CHESS_RENDERER_URL;
const CAPTURE_PATH = process.env.CHESS_CAPTURE_PATH;
const CAPTURE_SCRIPT = process.env.CHESS_CAPTURE_SCRIPT;
const CAPTURE_QUERY = process.env.CHESS_CAPTURE_QUERY;
const IS_SMOKE_TEST = Boolean(CAPTURE_PATH);
const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

// Windows taskbar grouping / notification identity must match the appId.
if (IS_WINDOWS) app.setAppUserModelId('com.nocturne.chess');

let mainWindow: BrowserWindow | null = null;
let backend: ChessServer | null = null;
let shuttingDown = false;

function resolveWebDist(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(app.getAppPath(), 'apps', 'web', 'dist');
}

async function startBackend(): Promise<ChessServer> {
  return createChessServer({
    host: '127.0.0.1',
    port: 0,
    staticDir: resolveWebDist(),
    log: (level, message, meta) => {
      const line = `[backend:${level}] ${message}`;
      if (meta === undefined) console.log(line);
      else console.log(line, meta);
    },
  });
}

/**
 * macOS expects a real application menu: without it, standard shortcuts such as
 * Cmd+Q, Cmd+W and Cmd+C stop working and the menu bar has no application entry.
 * Windows/Linux keep the cleaner menu-less presentation.
 */
function installApplicationMenu(): void {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(server: ChessServer): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#080a0d',
    title: 'Nocturne Chess',
    autoHideMenuBar: true,
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      backgroundThrottling: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
  });

  if (IS_SMOKE_TEST || process.env.CHESS_LOG_RENDERER === '1') {
    window.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone', details);
    });
    window.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[renderer] failed to load ${url}: ${description} (${code})`);
    });
  }

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  const baseTarget = DEV_RENDERER_URL ?? server.url;
  const target = CAPTURE_QUERY ? `${baseTarget}${CAPTURE_QUERY}` : baseTarget;
  void window.loadURL(target);

  if (process.env.CHESS_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

function captureWhenReady(window: BrowserWindow): void {
  if (!CAPTURE_PATH) return;
  window.webContents.once('did-finish-load', () => {
    // Give WebGL a few frames to compile shaders and settle the intro motion.
    setTimeout(async () => {
      try {
        if (CAPTURE_SCRIPT) {
          const script = fs.readFileSync(CAPTURE_SCRIPT, 'utf8');
          const result = await window.webContents.executeJavaScript(script, true);
          if (result !== undefined) console.log('[smoke] script result', result);
        }
        fs.mkdirSync(path.dirname(CAPTURE_PATH), { recursive: true });
        const image = await window.webContents.capturePage();
        fs.writeFileSync(CAPTURE_PATH, image.toPNG());
        console.log(`[smoke] screenshot written to ${CAPTURE_PATH}`);
      } catch (error) {
        console.error('[smoke] screenshot failed', error);
        process.exitCode = 1;
      } finally {
        if (IS_SMOKE_TEST) app.quit();
      }
    }, Number(process.env.CHESS_CAPTURE_DELAY ?? 5000));
  });
}

async function bootstrap(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  await app.whenReady();

  installApplicationMenu();

  if (!DEV_RENDERER_URL) {
    backend = await startBackend();
  }

  // In split dev mode a standalone backend (port 8787) is proxied by Vite.
  const server =
    backend ??
    ({ url: DEV_RENDERER_URL ?? 'http://127.0.0.1:5173', token: '', port: 0, host: '127.0.0.1' } as const);

  mainWindow = createWindow(server as ChessServer);
  captureWhenReady(mainWindow);

  ipcMain.handle('desktop:info', () => ({
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    appVersion: app.getVersion(),
  }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(server as ChessServer);
      captureWhenReady(mainWindow);
    }
  });
}

app.on('window-all-closed', () => {
  if (!IS_MAC || IS_SMOKE_TEST) app.quit();
});

app.on('before-quit', (event) => {
  if (!backend || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void backend.close().finally(() => {
    backend = null;
    app.quit();
  });
});

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[main] unhandled rejection', error);
});

void bootstrap().catch((error) => {
  console.error('[main] failed to start', error);
  app.quit();
});
