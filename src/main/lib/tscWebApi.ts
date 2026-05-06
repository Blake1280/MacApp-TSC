/* TSC Web API constants and fetch helper.
 *
 * The Electron inventory app talks to the Netlify-hosted website's HTTPS
 * functions for two things:
 *   1. List orders + payment status (so Jade sees who paid without opening
 *      Stripe Dashboard).
 *   2. Push stocktake snapshot up so the website can render
 *      "only N left" badges.
 *
 * Both endpoints require the X-API-Key header. The key is a shared secret
 * baked into both this app and the Netlify INVENTORY_API_KEY env var.
 *
 * Override at runtime if needed:
 *   TSC_WEB_BASE      e.g. "https://staging.thesweetcreative.com.au"
 *   TSC_WEB_API_KEY   override the bundled key (rotation, dev, etc.)
 */

export const TSC_WEB_BASE =
  process.env.TSC_WEB_BASE || 'https://thesweetcreative.com.au/.netlify/functions';

export const TSC_WEB_API_KEY =
  process.env.TSC_WEB_API_KEY || 'g3M8_Uw4wZwWQzXOymhSWKI0xZQXIAmC';

export class TscWebApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'TscWebApiError';
  }
}

/** GET helper — auth-gated. Throws TscWebApiError on non-2xx. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${TSC_WEB_BASE}${path}`, {
    method: 'GET',
    headers: { 'X-API-Key': TSC_WEB_API_KEY, Accept: 'application/json' },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: text }; }
  if (!res.ok) {
    const msg = (body as { error?: string }).error || `HTTP ${res.status}`;
    throw new TscWebApiError(res.status, msg);
  }
  return body as T;
}

/** POST helper — auth-gated, JSON body. Throws TscWebApiError on non-2xx. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TSC_WEB_BASE}${path}`, {
    method: 'POST',
    headers: {
      'X-API-Key': TSC_WEB_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let respBody: unknown;
  try { respBody = JSON.parse(text); } catch { respBody = { error: text }; }
  if (!res.ok) {
    const msg = (respBody as { error?: string }).error || `HTTP ${res.status}`;
    throw new TscWebApiError(res.status, msg);
  }
  return respBody as T;
}
