import { dialog } from 'electron';
import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { applyImport, buildPreview } from '@main/importer/tscDataImporter';
import { importApplySchema, importPreviewSchema } from '@shared/schema';

export const importerRouter = router({
  pickPath: publicProcedure
    .input(z.object({ kind: z.enum(['file', 'directory']) }))
    .mutation(async ({ input }) => {
      const result = await dialog.showOpenDialog({
        title:
          input.kind === 'file'
            ? 'Select product-data.js or a Netlify .zip'
            : 'Select the unzipped Netlify deploy folder',
        properties: input.kind === 'file' ? ['openFile'] : ['openDirectory'],
        filters:
          input.kind === 'file'
            ? [
                { name: 'product-data.js or ZIP', extensions: ['js', 'zip'] },
                { name: 'All files', extensions: ['*'] },
              ]
            : undefined,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }),

  preview: publicProcedure.input(importPreviewSchema).query(({ input }) => buildPreview(input.path)),

  apply: publicProcedure.input(importApplySchema).mutation(({ input }) =>
    applyImport(input.path, {
      autoCreateAddonInventory: input.autoCreateAddonInventory,
      autoSeedAddonRecipes: input.autoSeedAddonRecipes,
      importBundles: input.importBundles,
      autoSeedBundleRecipes: input.autoSeedBundleRecipes,
      autoSeedFinishRecipes: input.autoSeedFinishRecipes,
      autoSeedPaletteRecipes: input.autoSeedPaletteRecipes,
    }),
  ),
});
