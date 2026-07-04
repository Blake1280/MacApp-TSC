import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@main/logging/logger';
import { seedDemoOrders } from '@main/lib/demoSeed';

/**
 * Headless page-capture mode, for verifying UI changes without touching the
 * user's screen or data. Activated by setting CAPTURE_DIR; pair it with
 * CAPTURE_USER_DATA pointing at a scratch copy of userData so the run can't
 * contend with the real database (two processes on one SQLite file is how
 * the July 2026 corruption happened).
 *
 *   CAPTURE_USER_DATA=<scratch dir> CAPTURE_DIR=<out dir> npm run dev
 *
 * The window stays hidden (capturePage paints it offscreen), demo orders are
 * seeded so list pages have real-shaped data, every route is snapshotted to
 * JPEG, and the app quits.
 */
const ROUTES = [
  '/dashboard',
  '/orders',
  '/web-orders',
  '/inventory',
  '/reorder',
  '/margins',
  '/products',
  '/audit',
  '/settings',
];

export function isCaptureMode(): boolean {
  return !!process.env['CAPTURE_DIR'];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCaptureSequence(win: BrowserWindow): Promise<void> {
  const dir = process.env['CAPTURE_DIR']!;
  mkdirSync(dir, { recursive: true });

  try {
    const seeded = seedDemoOrders();
    logger.info('Capture: demo orders seeded', seeded);
  } catch (err) {
    logger.warn('Capture: demo seed failed', { error: String(err) });
  }

  // The sidebar's backdrop-filter promotes it to its own compositing layer,
  // which goes stale (lags one navigation) in hidden-window captures.
  // Disable it for the capture run only.
  await win.webContents.insertCSS('aside { backdrop-filter: none !important; }');

  // Let the renderer boot and the first round of queries settle.
  await sleep(3000);

  for (const route of ROUTES) {
    win.webContents.send('menu:navigate', route);
    await sleep(1200);
    // Hidden windows serve a stale composite one navigation behind. A
    // throwaway capture kicks the compositor into producing a fresh frame;
    // the second capture reads it.
    win.webContents.invalidate();
    await win.webContents.capturePage();
    await sleep(600);
    try {
      const image = await win.webContents.capturePage();
      const file = join(dir, `${route.replace('/', '')}.jpg`);
      writeFileSync(file, image.toJPEG(85));
      logger.info('Capture: saved', { file });
    } catch (err) {
      logger.warn('Capture: failed', { route, error: String(err) });
    }
  }

  app.quit();
}
