import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import {
  catalogueEntryArchiveSchema,
  catalogueEntryCreateSchema,
  catalogueEntryUpdateSchema,
  catalogueKindSchema,
  recipeComponentDeleteSchema,
  recipeComponentUpsertSchema,
} from '@shared/schema';

export const catalogueRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          kind: catalogueKindSchema.optional(),
          includeArchived: z.boolean().optional(),
        })
        .optional(),
    )
    .query(({ input }) =>
      new CatalogueRepo(getDb()).list({
        kind: input?.kind,
        includeArchived: input?.includeArchived ?? false,
      }),
    ),

  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => new CatalogueRepo(getDb()).byId(input.id)),

  create: publicProcedure.input(catalogueEntryCreateSchema).mutation(({ input }) => {
    const db = getDb();
    const catalogue = new CatalogueRepo(db);
    const inventory = new InventoryRepo(db);

    const tx = db.transaction(() => {
      if (catalogue.byKindAndExternalId(input.kind, input.external_id)) {
        throw new Error(
          `A ${input.kind} with id "${input.external_id}" already exists. Pick a different id.`,
        );
      }
      const entry = catalogue.create({
        kind: input.kind,
        external_id: input.external_id,
        name: input.name,
        price_cents: input.price_cents ?? null,
        default_finish_id: input.default_finish_id ?? null,
        default_palette_id: input.default_palette_id ?? null,
      });

      if (input.autoCreateInventoryItem) {
        const sku = `${input.kind}-${input.external_id}`;
        if (!inventory.bySku(sku)) {
          const item = inventory.create({
            sku,
            name: input.name,
            category: input.kind,
            unit: 'each',
            on_hand: 0,
            reorder_at: 0,
            cost_cents: null,
            notes: `Auto-created from ${input.kind} '${input.external_id}'.`,
          });
          catalogue.upsertRecipeComponent({
            catalogue_id: entry.id,
            inventory_item_id: item.id,
            quantity: 1,
          });
        }
      }

      return entry;
    });
    return tx();
  }),

  update: publicProcedure.input(catalogueEntryUpdateSchema).mutation(({ input }) => {
    return new CatalogueRepo(getDb()).update(input);
  }),

  setArchived: publicProcedure
    .input(catalogueEntryArchiveSchema)
    .mutation(({ input }) => new CatalogueRepo(getDb()).setArchived(input.id, input.archived)),

  recipeComponents: publicProcedure
    .input(z.object({ catalogue_id: z.number().int().positive() }))
    .query(({ input }) => new CatalogueRepo(getDb()).recipeComponents(input.catalogue_id)),

  upsertRecipeComponent: publicProcedure
    .input(recipeComponentUpsertSchema)
    .mutation(({ input }) => {
      new CatalogueRepo(getDb()).upsertRecipeComponent(input);
      return { ok: true as const };
    }),

  deleteRecipeComponent: publicProcedure
    .input(recipeComponentDeleteSchema)
    .mutation(({ input }) => {
      new CatalogueRepo(getDb()).deleteRecipeComponent(input.id);
      return { ok: true as const };
    }),
});
