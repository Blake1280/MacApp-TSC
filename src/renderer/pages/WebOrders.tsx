import { useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, XCircle, ExternalLink } from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { formatCents, formatDate } from '../lib/format';

/** Web orders — pulls authoritative payment status from the website's
 *  Supabase mirror. The Stripe webhook updates `payment_status` server-side,
 *  so this view answers "did this customer actually pay?" without anyone
 *  having to log into Stripe Dashboard. */
export default function WebOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'paid' | 'awaiting_redirect' | 'failed' | 'expired' | 'refunded'
  >('all');

  const ordersQuery = trpc.tscWeb.listOrders.useQuery(
    {
      limit: 200,
      status: statusFilter === 'all' ? undefined : [statusFilter],
    },
    {
      // Refresh every 30s while the page is open so payment status updates
      // appear without a manual refresh.
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    },
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, paid: 0, awaiting_redirect: 0, failed: 0, expired: 0, refunded: 0 };
    for (const o of ordersQuery.data?.orders ?? []) {
      c.all += 1;
      c[o.payment_status] = (c[o.payment_status] ?? 0) + 1;
    }
    return c;
  }, [ordersQuery.data]);

  return (
    <div className="p-8 space-y-5 max-w-6xl">
      <header className="flex items-center justify-between gap-4">
        <div className="page-h1">
          <h1 className="text-3xl font-serif-brand font-medium leading-tight">Web orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live from the website. Payment status comes straight from Stripe via webhook —
            no need to open the Stripe Dashboard.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => ordersQuery.refetch()}
          disabled={ordersQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${ordersQuery.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </header>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        {(['all', 'paid', 'awaiting_redirect', 'failed', 'expired', 'refunded'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              statusFilter === s
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {labelForStatus(s)} {counts[s] ? <span className="ml-1 opacity-70">{counts[s]}</span> : null}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {ordersQuery.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Couldn&rsquo;t reach the website API.</div>
            <div className="opacity-80">{ordersQuery.error.message}</div>
          </div>
        </div>
      )}

      {/* Empty / loading */}
      {ordersQuery.isLoading && (
        <div className="rounded-lg border bg-card px-4 py-12 text-center text-muted-foreground">
          Loading orders from the website…
        </div>
      )}
      {!ordersQuery.isLoading && (ordersQuery.data?.orders.length ?? 0) === 0 && (
        <div className="rounded-lg border border-dashed bg-card px-4 py-12 text-center text-muted-foreground">
          No web orders yet. Customer checkouts will appear here automatically.
        </div>
      )}

      {/* Orders list */}
      {ordersQuery.data?.orders.map((o) => (
        <article key={o.id} className="brand-surface p-4 space-y-2">
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base">
                  {o.customer_name || 'Unnamed customer'}
                </h3>
                <PaymentBadge status={o.payment_status} />
                {o.stripe_mode === 'test' && (
                  <span className="brand-pill brand-pill-new text-[10px] uppercase tracking-wide">
                    test mode
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {o.customer_email || '—'} · {o.customer_phone || '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">{formatCents(o.amount_cents)}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {o.payment_method_type || 'card'}
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <Field label="Flow">{o.flow_type === 'bundle' ? `Bundle: ${o.bundle_name || o.bundle_id}` : 'BYO'}</Field>
            <Field label="Finish">{o.finish_name || o.finish_id || '—'}</Field>
            <Field label="Palette">{o.palette_name || o.palette_id || o.custom_palette || '—'}</Field>
            <Field label="Add-ons">{o.addons_summary || '—'}</Field>
            <Field label="For">{o.recipient || '—'}</Field>
            <Field label="Occasion">{o.occasion || '—'}</Field>
            <Field label="Fulfilment">{o.fulfilment || '—'}</Field>
            <Field label="When">
              {o.date_needed ? `${o.date_needed}${o.time_needed ? ` ${o.time_needed}` : ''}` : '—'}
            </Field>
          </div>

          {o.address && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              <span className="font-medium">Delivery: </span>
              {o.address}
              {o.delivery_zone && <span className="opacity-70"> · zone: {o.delivery_zone}</span>}
            </div>
          )}
          {o.notes && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              <span className="font-medium">Notes: </span>
              {o.notes}
            </div>
          )}

          <footer className="flex items-center justify-between text-[11px] text-muted-foreground border-t pt-2">
            <div>Placed {formatDate(o.created_at)}</div>
            {o.stripe_session_id && (
              <a
                className="inline-flex items-center gap-1 hover:text-foreground"
                href={`https://dashboard.stripe.com/${o.stripe_mode === 'test' ? 'test/' : ''}payments?query=${o.stripe_session_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Stripe session <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function PaymentBadge({ status }: { status: string }) {
  const cfg = badgeConfigForStatus(status);
  return (
    <span
      className={`brand-pill ${cfg.pillClass} text-[10px] uppercase tracking-wide`}
    >
      <cfg.icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

/**
 * Map payment status → brand pill variant. Re-uses the same brand-pill-*
 * classes Orders.tsx uses for app status, so the two pages read as one
 * composition rather than the previous Tailwind-rainbow look.
 *   paid       → confirmed   (rose-300 fill, deep rose text)
 *   awaiting   → new         (rose-50 fill, ring text)
 *   refunded   → refunded    (rose-50 fill, rose-700 text)
 *   failed     → cancelled   (muted)
 *   expired    → cancelled   (muted)
 */
function badgeConfigForStatus(status: string) {
  switch (status) {
    case 'paid':
      return { icon: CheckCircle2, pillClass: 'brand-pill-confirmed', label: 'paid' };
    case 'awaiting_redirect':
      return { icon: Clock, pillClass: 'brand-pill-new', label: 'awaiting' };
    case 'failed':
      return { icon: XCircle, pillClass: 'brand-pill-cancelled', label: 'failed' };
    case 'expired':
      return { icon: Clock, pillClass: 'brand-pill-cancelled', label: 'expired' };
    case 'refunded':
      return { icon: AlertTriangle, pillClass: 'brand-pill-refunded', label: 'refunded' };
    default:
      return { icon: AlertTriangle, pillClass: '', label: status };
  }
}

function labelForStatus(s: string) {
  if (s === 'all') return 'All';
  if (s === 'awaiting_redirect') return 'Awaiting';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
