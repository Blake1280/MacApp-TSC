import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { createIPCHandler } from 'electron-trpc/main';
import { logger } from '@main/logging/logger';
import { getDb, closeDb } from '@main/db/connection';
import { appRouter } from '@main/ipc/router';
import { startSyncEngine, stopSyncEngine } from '@main/sync/engine';
import { initAutoUpdater } from '@main/auth/updater';

const isDev = !app.isPackaged;

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
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
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

  createWindow();
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
