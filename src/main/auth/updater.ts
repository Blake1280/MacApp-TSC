import { app, dialog } from 'electron';
import { logger } from '@main/logging/logger';

/**
 * Lazily import electron-updater so we never throw at module load if the
 * package isn't bundled. Auto-update is configured via electron-builder.yml's
 * `publish` field. While that's `null`, this is a no-op.
 */
export async function initAutoUpdater(): Promise<void> {
  if (!app.isPackaged) {
    logger.debug('Skipping auto-updater (dev mode)');
    return;
  }
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => logger.info('Checking for update'));
    autoUpdater.on('update-available', (info) => {
      logger.info('Update available', info);
      void dialog.showMessageBox({
        type: 'info',
        title: 'Sweet Creative Inventory update',
        message: `Version ${info.version} is downloading in the background.`,
        detail: 'You can keep working. The app will let you know when it is ready to install.',
        buttons: ['OK'],
      });
    });
    autoUpdater.on('update-not-available', () => logger.debug('No update available'));
    autoUpdater.on('error', (err) => logger.warn('Auto-update error', err));
    autoUpdater.on('download-progress', (p) =>
      logger.debug('Download progress', { percent: p.percent }),
    );
    autoUpdater.on('update-downloaded', (info) => {
      logger.info('Update downloaded; ready to install', info);
      void dialog
        .showMessageBox({
          type: 'info',
          title: 'Update ready',
          message: `Version ${info.version} is ready to install.`,
          detail: 'Restart now to install it, or choose Later and it will install when you next quit the app.',
          buttons: ['Restart and install', 'Later'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
    });

    // Give the window a moment to become usable before checking network state.
    setTimeout(() => {
      void autoUpdater.checkForUpdates();
    }, 3_000);
  } catch (err) {
    // Most common cause: publish target not configured yet, which is fine.
    logger.debug('Auto-updater not active', { reason: String(err) });
  }
}
