import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { createIPCHandler } from 'electron-trpc/main';
import { logger } from '@main/logging/logger';
import { getDb, closeDb } from '@main/db/connection';
import { appRouter } from '@main/ipc/router';
import { startSyncEngine, stopSyncEngine } from '@main/sync/engine';
import { initAutoUpdater } from '@main/auth/updater';
import { installAppMenu } from '@main/menu';
import { isCaptureMode, runCaptureSequence } from '@main/capture';

const isDev = !app.isPackaged;

// Headless capture mode must swap userData BEFORE anything opens the
// database or log files — see capture.ts for the how and why.
if (isCaptureMode() && process.env['CAPTURE_USER_DATA']) {
  app.setPath('userData', process.env['CAPTURE_USER_DATA']);
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Sweet Creative Inventory',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep painting while hidden so capture mode can snapshot the window
      // without ever showing it (paintWhenInitiallyHidden defaults true).
      backgroundThrottling: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    if (!isCaptureMode()) mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    if (!isCaptureMode()) mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  createIPCHandler({ router: appRouter, windows: [mainWindow] });
}

app.whenReady().then(() => {
  logger.info('App ready', { version: app.getVersion(), platform: process.platform });

  try {
    getDb();
  } catch (err) {
    logger.error('Failed to open database', err);
    throw err;
  }

  installAppMenu(() => mainWindow);
  createWindow();

  if (isCaptureMode()) {
    // Snapshot every route and quit — no sync engine, no updater.
    mainWindow!.webContents.once('did-finish-load', () => {
      void runCaptureSequence(mainWindow!);
    });
    return;
  }

  startSyncEngine();
  void initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopSyncEngine();
  closeDb();
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
});
