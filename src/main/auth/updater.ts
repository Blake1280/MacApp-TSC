import { app } from 'electron';
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
    autoUpdater.on('update-available', (info) => logger.info('Update available', info));
    autoUpdater.on('update-not-available', () => logger.debug('No update available'));
    autoUpdater.on('error', (err) => logger.warn('Auto-update error', err));
    autoUpdater.on('download-progress', (p) =>
      logger.debug('Download progress', { percent: p.percent }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      logger.info('Update downloaded; will install on quit', info),
    );

    await autoUpdater.checkForUpdates();
  } catch (err) {
    // Most common cause: publish target not configured yet, which is fine.
    logger.debug('Auto-updater not active', { reason: String(err) });
  }
}
