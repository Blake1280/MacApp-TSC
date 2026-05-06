import { getSecret } from '@main/auth/secrets';
import type { NetlifyForm, NetlifySite } from '@shared/types';

export const NETLIFY_TOKEN_KEY = 'netlify_token';

const API_BASE = 'https://api.netlify.com/api/v1';

async function request<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Netlify ${res.status} ${res.statusText}: ${text || path}`);
  }
  return (await res.json()) as T;
}

export async function testNetlifyToken(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await request<unknown>(token.trim(), '/sites?per_page=1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listSites(): Promise<NetlifySite[]> {
  const token = getSecret(NETLIFY_TOKEN_KEY);
  if (!token) throw new Error('Netlify is not connected.');
  const sites = await request<Array<{ id: string; name: string; url: string; ssl_url?: string }>>(
    token,
    '/sites?per_page=100',
  );
  return sites.map((s) => ({ id: s.id, name: s.name, url: s.ssl_url ?? s.url }));
}

export async function listForms(siteId: string): Promise<NetlifyForm[]> {
  const token = getSecret(NETLIFY_TOKEN_KEY);
  if (!token) throw new Error('Netlify is not connected.');
  const forms = await request<Array<{ id: string; name: string; submission_count: number }>>(
    token,
    `/sites/${siteId}/forms`,
  );
  return forms.map((f) => ({ id: f.id, name: f.name, submission_count: f.submission_count }));
}

export type NetlifyRawSubmission = {
  id: string;
  number: number;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  summary: string | null;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  human_fields: Record<string, string> | null;
  ordered_human_fields: Array<{ name: string; title: string; value: string }> | null;
  form_id: string;
  form_name: string;
  site_url: string;
};

export async function listFormSubmissions(
  formId: string,
  options: { perPage?: number; page?: number } = {},
): Promise<NetlifyRawSubmission[]> {
  const token = getSecret(NETLIFY_TOKEN_KEY);
  if (!token) throw new Error('Netlify is not connected.');
  const perPage = options.perPage ?? 100;
  const page = options.page ?? 1;
  return request<NetlifyRawSubmission[]>(
    token,
    `/forms/${formId}/submissions?per_page=${perPage}&page=${page}`,
  );
}
