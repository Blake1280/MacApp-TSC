import { shell } from 'electron';
import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { SuppliersRepo } from '@main/db/repositories/suppliers.repo';
import {
  supplierSourceCreateSchema,
  supplierSourceDeleteSchema,
  supplierSourceUpdateSchema,
} from '@shared/schema';

/** Allow only http(s) URLs through openExternal — otherwise the renderer
 * could ask the OS to launch arbitrary protocols (mailto:, file:, etc.). */
function isSafeWebUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const suppliersRouter = router({
  forItem: publicProcedure
    .input(z.object({ inventory_item_id: z.number().int().positive() }))
    .query(({ input }) => new SuppliersRepo(getDb()).forItem(input.inventory_item_id)),

  forItems: publicProcedure
    .input(z.object({ inventory_item_ids: z.array(z.number().int().positive()) }))
    .query(({ input }) => {
      const map = new SuppliersRepo(getDb()).forItems(input.inventory_item_ids);
      // Convert Map → object so it serialises cleanly over tRPC
      const out: Record<number, ReturnType<typeof Object>> = {};
      for (const [k, v] of map) out[k] = v as unknown as Record<string, unknown>;
      return out;
    }),

  create: publicProcedure
    .input(supplierSourceCreateSchema)
    .mutation(({ input }) =>
      new SuppliersRepo(getDb()).create({
        inventory_item_id: input.inventory_item_id,
        supplier_name: input.supplier_name,
        url: input.url,
        unit_price_cents: input.unit_price_cents ?? null,
        is_preferred: input.is_preferred,
        notes: input.notes ?? null,
        photo_url: input.photo_url ?? null,
      }),
    ),

  update: publicProcedure
    .input(supplierSourceUpdateSchema)
    .mutation(({ input }) => new SuppliersRepo(getDb()).update(input)),

  delete: publicProcedure
    .input(supplierSourceDeleteSchema)
    .mutation(({ input }) => {
      new SuppliersRepo(getDb()).delete(input.id);
      return { ok: true as const };
    }),

  /**
   * Open a supplier URL in the user's default browser. We don't want the
   * renderer to call shell.openExternal directly — keeps the renderer free
   * of Electron Node APIs and lets us validate the URL.
   */
  openUrl: publicProcedure
    .input(z.object({ url: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!isSafeWebUrl(input.url)) {
        throw new Error(`Refused to open non-http(s) URL: ${input.url}`);
      }
      await shell.openExternal(input.url);
      return { ok: true as const };
    }),
});
