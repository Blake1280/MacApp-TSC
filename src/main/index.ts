import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'node:path';
import { createIPCHandler } from 'electron-trpc/main';
import { logger } from '@main/logging/logger';
import { getDb, closeDb, getLastRestoreResult } from '@main/db/connection';
import { backupDatabase } from '@main/db/backup';
import { appRouter } from '@main/ipc/router';
import { startSyncEngine, stopSyncEngine } from '@main/sync/engine';
import { initAutoUpdater } from '@main/auth/updater';
import { installAppMenu } from '@main/menu';
import { isCaptureMode, runCaptureSequence } from '@main/capture';
import { syncWebsiteCatalogue } from '@main/lib/catalogueSync';

const isDev = !app.isPackaged;

// Headless capture mode must swap userData BEFORE anything opens the
// database or log files — see capture.ts for the how and why.
if (isCaptureMode() && process.env['CAPTURE_USER_DATA']) {
  app.setPath('userData', process.env['CAPTURE_USER_DATA']);
} else if (isDev) {
  // Dev runs get their own sandbox. The July 2026 corruption traced back to
  // a dev build and the installed app sharing one database file — never
  // again. Point dev at the real db explicitly with TSC_DB_PATH if needed.
  app.setPath('userData', `${app.getPath('userData')}-dev`);
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

app.whenReady().then(async () => {
  logger.info('App ready', { version: app.getVersion(), platform: process.platform });

  try {
    getDb();
  } catch (err) {
    logger.error('Failed to open database', err);
    dialog.showErrorBox(
      'Sweet Creative Inventory — database problem',
      'The database could not be opened and no automatic backup was available to restore.\n\n' +
        'Nothing has been deleted — the damaged file has been kept next to the ' +
        'original. Please get in touch with Blake before using the app.',
    );
    throw err;
  }

  // If the boot had to fall back to a backup, say so plainly — Jade should
  // know she may be missing the last few hours of changes.
  const restore = getLastRestoreResult();
  if (restore?.restored) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Sweet Creative Inventory',
      message: 'The database was damaged and has been restored from a backup.',
      detail:
        `Backup used: ${restore.backupUsed ?? 'unknown'}\n\n` +
        'Anything entered after that backup was taken may be missing — worth a ' +
        'quick check of recent orders and stock counts. The damaged file has ' +
        'been kept alongside the database in case anything needs digging out.',
      buttons: ['OK'],
    });
  }

  // Snapshot a healthy database on every launch (async, non-blocking) and
  // keep the newest 14 — see db/backup.ts.
  void (async () => {
    try {
      await backupDatabase(getDb(), app.getPath('userData'));
    } catch (err) {
      logger.warn('Startup backup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  if (!isCaptureMode()) {
    try {
      const result = await syncWebsiteCatalogue();
      logger.info('Website catalogue sync complete', {
        inserted: result.inserted,
        updated: result.updated,
        inventoryAutoCreated: result.inventoryAutoCreated,
        bundleRecipeComponents: result.bundleRecipesAutoSeeded,
        warnings: result.bundleRecipeWarnings.length + result.finishRecipeWarnings.length,
      });
    } catch (err) {
      logger.warn('Website catalogue sync skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
