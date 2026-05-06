import Stripe from 'stripe';
import { getSecret } from '@main/auth/secrets';

export const STRIPE_SECRET_KEY = 'stripe_secret_key';

export function getStripeClient(): Stripe | null {
  const key = getSecret(STRIPE_SECRET_KEY);
  if (!key) return null;
  return new Stripe(key, {
    appInfo: { name: 'Sweet Creative Inventory', version: '0.1.0' },
    typescript: true,
  });
}

export async function testStripeKey(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk_') && !trimmed.startsWith('rk_')) {
      return { ok: false, error: 'Key must start with sk_ or rk_ (Stripe secret or restricted key).' };
    }
    const stripe = new Stripe(trimmed, {
      appInfo: { name: 'Sweet Creative Inventory', version: '0.1.0' },
    });
    await stripe.checkout.sessions.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
