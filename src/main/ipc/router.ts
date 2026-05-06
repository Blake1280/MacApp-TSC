import { router } from '@main/ipc/trpc';
import { inventoryRouter } from '@main/ipc/inventory';
import { settingsRouter } from '@main/ipc/settings';
import { catalogueRouter } from '@main/ipc/catalogue';
import { importerRouter } from '@main/ipc/importer';
import { stocktakeRouter } from '@main/ipc/stocktake';
import { suppliersRouter } from '@main/ipc/suppliers';
import { stripeRouter } from '@main/ipc/stripe';
import { netlifyRouter } from '@main/ipc/netlify';
import { syncRouter } from '@main/ipc/sync';
import { ordersRouter } from '@main/ipc/orders';
import { dashboardRouter } from '@main/ipc/dashboard';
import { auditRouter } from '@main/ipc/audit';
import { backupRouter } from '@main/ipc/backup';
import { marginsRouter } from '@main/ipc/margins';
import { tscWebRouter } from '@main/ipc/tscWeb';

export const appRouter = router({
  inventory: inventoryRouter,
  settings: settingsRouter,
  catalogue: catalogueRouter,
  importer: importerRouter,
  stocktake: stocktakeRouter,
  suppliers: suppliersRouter,
  stripe: stripeRouter,
  netlify: netlifyRouter,
  sync: syncRouter,
  orders: ordersRouter,
  dashboard: dashboardRouter,
  audit: auditRouter,
  backup: backupRouter,
  margins: marginsRouter,
  tscWeb: tscWebRouter,
});

export type AppRouter = typeof appRouter;
