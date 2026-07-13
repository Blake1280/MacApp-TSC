import { dialog } from 'electron';
import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import {
  applyStocktakeImport,
  buildStocktakePreview,
  exportStocktake,
} from '@main/importer/stocktakeXlsxImporter';
import { stocktakeApplySchema, stocktakePreviewSchema } from '@shared/schema';
import { getDb } from '@main/db/connection';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import { apiPost } from '@main/lib/tscWebApi';
import { hasSecret } from '@main/auth/secrets';

export const stocktakeRouter = router({
  pickPath: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select stocktake XLSX',
        properties: ['openFile'],
        filters: [
          { name: 'Excel workbook', extensions: ['xlsx', 'xlsm'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }),

  preview: publicProcedure
    .input(stocktakePreviewSchema)
    .query(({ input }) => buildStocktakePreview(input.path)),

  apply: publicProcedure
    .input(stocktakeApplySchema)
    .mutation(async ({ input }) => {
      const result = applyStocktakeImport(input.path, {
        createMissingInventory: input.createMissingInventory,
        upsertCatalogue: input.upsertCatalogue,
        upsertRecipes: input.upsertRecipes,
        acknowledgeStale: input.acknowledgeStale,
        archiveMissing: input.archiveMissing,
      });
      if (hasSecret('tsc_web_api_key')) {
        const items = new InventoryRepo(getDb()).list({ includeArchived: true, lowStockOnly: false })
          .filter((item) => item.stock_tracked !== 0)
          .map((item) => ({ sku: item.sku, name: item.name, category: item.category, on_hand: item.on_hand, reorder_at: item.reorder_at, archived: !!item.archived, updated_at: item.updated_at }));
        await apiPost('/inventory-sync', { items });
      }
      return result;
    }),

  /**
   * Export the current inventory to a stocktake XLSX. Two-step UX:
   *   1. `pickExportPath` opens a save dialog and returns the chosen path
   *   2. `export` writes the file at that path
   */
  pickExportPath: publicProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      const result = await dialog.showSaveDialog({
        title: 'Export current stocktake',
        defaultPath: 'sweet-creative-stocktake.xlsx',
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return null;
      return result.filePath;
    }),

  export: publicProcedure
    .input(z.object({ path: z.string().trim().min(1) }))
    .mutation(({ input }) => exportStocktake(input.path)),
});
