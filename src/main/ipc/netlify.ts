import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { clearSecret, hasSecret, setSecret } from '@main/auth/secrets';
import {
  NETLIFY_TOKEN_KEY,
  listForms,
  listSites,
  testNetlifyToken,
} from '@main/netlify/client';
import { netlifyConnectSchema, netlifySetTargetSchema } from '@shared/schema';
import type { NetlifyConnectionStatus } from '@shared/types';

function readSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeSetting(key: string, value: string | null) {
  if (value === null) {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}

function readSyncStateRow() {
  return getDb()
    .prepare('SELECT * FROM sync_state WHERE source = ?')
    .get('netlify') as
    | { last_run_at: string | null; last_success_at: string | null; last_error: string | null }
    | undefined;
}

export const netlifyRouter = router({
  status: publicProcedure.query((): NetlifyConnectionStatus => {
    const state = readSyncStateRow();
    return {
      connected: hasSecret(NETLIFY_TOKEN_KEY),
      last_synced_at: state?.last_success_at ?? null,
      last_error: state?.last_error ?? null,
      site_id: readSetting('netlify.site_id'),
      site_name: readSetting('netlify.site_name'),
      form_id: readSetting('netlify.form_id'),
      form_name: readSetting('netlify.form_name'),
    };
  }),

  connect: publicProcedure.input(netlifyConnectSchema).mutation(async ({ input }) => {
    const test = await testNetlifyToken(input.token);
    if (!test.ok) throw new Error(`Netlify rejected the token: ${test.error}`);
    setSecret(NETLIFY_TOKEN_KEY, input.token.trim());
    return { ok: true as const };
  }),

  disconnect: publicProcedure.mutation(() => {
    clearSecret(NETLIFY_TOKEN_KEY);
    writeSetting('netlify.site_id', null);
    writeSetting('netlify.site_name', null);
    writeSetting('netlify.form_id', null);
    writeSetting('netlify.form_name', null);
    return { ok: true as const };
  }),

  listSites: publicProcedure.query(() => listSites()),

  listForms: publicProcedure
    .input(z.object({ site_id: z.string().min(1) }))
    .query(({ input }) => listForms(input.site_id)),

  setTarget: publicProcedure.input(netlifySetTargetSchema).mutation(({ input }) => {
    writeSetting('netlify.site_id', input.site_id);
    writeSetting('netlify.site_name', input.site_name);
    writeSetting('netlify.form_id', input.form_id);
    writeSetting('netlify.form_name', input.form_name);
    return { ok: true as const };
  }),
});
