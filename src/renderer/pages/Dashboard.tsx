import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Receipt,
  Boxes,
  XCircle,
  RefreshCw,
  Mail,
  PackageCheck,
  Truck,
} from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/EmptyState';
import { SyncFailureBanner } from '../components/SyncFailureBanner';
import { formatCents, formatDate } from '../lib/format';
import type { DashboardSummary, OrderListItem } from '@shared/types';

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const utils = trpc.useUtils();
  const summary = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  // Optional display name. Settings.set(key='display_name') from the
  // wizard / Settings page populates this. Falls back to no name when
  // unset so multiple operators (Brett + Jade) aren't both addressed
  // as Jade. Keeping the warm greeting either way.
  const displayName = trpc.settings.get.useQuery({ key: 'display_name' });
  const runAll = trpc.sync.runAll.useMutation({
    onSuccess: () => {
      utils.dashboard.summary.invalidate();
      utils.orders.list.invalidate();
      utils.stripe.status.invalidate();
      utils.netlify.status.invalidate();
    },
  });
  const markFulfilled = trpc.orders.setStatus.useMutation({
    onSuccess: () => {
      utils.dashboard.summary.invalidate();
      utils.orders.list.invalidate();
    },
  });
  const navigate = useNavigate();

  const data = summary.data;
  const name = (displayName.data ?? '').trim();
  const headline = name ? `${greeting()}, ${name}` : greeting();

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between gap-4">
        <div className="page-h1">
          <h1 className="text-3xl font-serif-brand font-medium leading-tight">
            {headline}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Today at a glance. Click any tile to drill in.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runAll.mutate()}
          disabled={runAll.isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${runAll.isLoading ? 'animate-spin' : ''}`} />
          Sync now
        </Button>
      </header>

      <EmailOfflineBanner />

      {data && (
        <SyncFailureBanner
          failures={syncFailures(data.sync)}
          onRetry={() => runAll.mutate()}
          retrying={runAll.isLoading}
        />
      )}

      {data && <SyncStrip sync={data.sync} />}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Today's orders"
          value={data?.today.order_count ?? 0}
          sub={data ? formatCents(data.today.revenue_cents) : '—'}
          onClick={() => navigate('/orders')}
        />
        <Tile
          label="New orders"
          value={data?.pending.new_orders ?? 0}
          sub="Click to confirm and make"
          tone={data && data.pending.new_orders > 0 ? 'attention' : undefined}
          onClick={() => navigate('/orders')}
        />
        <Tile
          label="Needs review"
          value={data?.pending.needs_review ?? 0}
          sub="Came in via the form but Stripe hasn't matched yet"
          tone={data && data.pending.needs_review > 0 ? 'warn' : undefined}
          onClick={() => navigate('/orders')}
        />
        <Tile
          label="Low stock"
          value={data?.low_stock.length ?? 0}
          sub={
            data && data.low_stock.length > 0
              ? 'Click to see items'
              : 'All above thresholds'
          }
          tone={data && data.low_stock.length > 0 ? 'warn' : undefined}
          onClick={() => navigate('/inventory')}
        />
      </section>

      <FulfilmentQueue
        orders={data?.fulfilment_queue ?? []}
        onOpen={(id) => navigate(`/orders/${id}`)}
        onMarkFulfilled={(id) => markFulfilled.mutate({ id, app_status: 'fulfilled' })}
        completingId={markFulfilled.isLoading ? markFulfilled.variables?.id : undefined}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <RecentOrdersCard orders={data?.recent_orders ?? []} />
        <LowStockCard items={data?.low_stock ?? []} />
      </div>

      {data && data.stock_alerts.length > 0 && <StockAlertsCard alerts={data.stock_alerts} />}
    </div>
  );
}

function FulfilmentQueue({
  orders,
  onOpen,
  onMarkFulfilled,
  completingId,
}: {
  orders: OrderListItem[];
  onOpen: (id: number) => void;
  onMarkFulfilled: (id: number) => void;
  completingId?: number;
}) {
  return (
    <section className="brand-surface overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium inline-flex items-center gap-2">
            <PackageCheck className="h-4 w-4" /> Fulfilment queue
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Paid orders that still need your attention.</p>
        </div>
        <span className="brand-pill">{orders.length} active</span>
      </header>
      {orders.length === 0 ? (
        <EmptyState tagline="Nothing waiting to be made." message="Paid orders will appear here in due-date order." />
      ) : (
        <ul className="divide-y">
          {orders.map((order) => {
            const isConfirmed = order.app_status === 'confirmed';
            const isPickup = order.delivery_zone === 'pickup';
            const FulfilmentIcon = isPickup ? PackageCheck : Truck;
            return (
              <li key={order.id} className="px-4 py-3 flex items-center gap-3">
                <FulfilmentIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <button
                  onClick={() => onOpen(order.id)}
                  className="flex-1 min-w-0 text-left hover:opacity-75"
                >
                  <div className="text-sm truncate">
                    {order.customer_name ?? 'Customer'}
                    {order.recipient ? <span className="text-muted-foreground"> for {order.recipient}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {neededLabel(order)} · {isPickup ? 'pickup' : 'delivery'}
                    {order.customer_phone ? ` · ${order.customer_phone}` : ''}
                  </div>
                </button>
                {isConfirmed ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onMarkFulfilled(order.id)}
                    disabled={completingId === order.id}
                  >
                    {completingId === order.id ? 'Completing...' : 'Mark fulfilled'}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onOpen(order.id)}>
                    Confirm & make
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function neededLabel(order: OrderListItem): string {
  if (!order.date_needed) return 'No date supplied';
  const date = new Date(`${order.date_needed}T00:00:00`);
  if (Number.isNaN(date.getTime())) return order.date_needed;
  const day = date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  return order.time_needed ? `${day}, ${order.time_needed}` : day;
}

/**
 * Banner shown at the top of the Dashboard when email notifications
 * for the Jade@thesweetcreative.com.au inbox aren't reliably working.
 * Set up while the GoDaddy mail hosting / SPF / MX records are still
 * being configured — orders flow into the app via Stripe + Netlify
 * Forms sync regardless, but Jade won't get a "you have a new order"
 * email until the inbox is wired. This banner reminds her to check
 * the dashboard daily until she dismisses it.
 *
 * Storage: settings table key `email_notifications_offline`. Default
 * is "1" (banner shown). Click "Mark as working" to set "0" and hide.
 * Re-show by toggling back to "1" in the Settings page → Email row.
 */
function EmailOfflineBanner() {
  const utils = trpc.useUtils();
  const setting = trpc.settings.get.useQuery({ key: 'email_notifications_offline' });
  const set = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'email_notifications_offline' }),
  });
  // Default to shown when the setting hasn't been touched yet (fresh
  // install). '0' explicitly hides; anything else (including '1' or
  // unset) shows the banner.
  const value = setting.data;
  const shown = value !== '0';
  if (!shown) return null;
  return (
    <section className="brand-alert-warn px-4 py-3">
      <div className="flex items-start gap-3">
        <Mail className="h-5 w-5 brand-alert-warn-strong mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="text-sm font-medium brand-alert-warn-strong">
            Email notifications offline — check this dashboard daily
          </div>
          <p className="text-xs opacity-80">
            Orders are still flowing in via Stripe + Netlify Forms (synced
            every 5 min) — they show up in <strong>New orders</strong> and{' '}
            <strong>Today's orders</strong> below. The "you have a new order"
            email won't land until the <code>Jade@thesweetcreative.com.au</code>{' '}
            inbox is fully wired (SPF / MX records on the domain). Until then,
            open this dashboard once a day to see what's come in.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => set.mutate({ key: 'email_notifications_offline', value: '0' })}
          disabled={set.isLoading}
        >
          Mark email as working
        </Button>
      </div>
    </section>
  );
}

function syncFailures(sync: DashboardSummary['sync']): Array<{ source: string; error: string }> {
  const failures: Array<{ source: string; error: string }> = [];
  if (sync.stripe.connected && sync.stripe.last_error) {
    failures.push({ source: 'Stripe', error: sync.stripe.last_error });
  }
  if (sync.netlify.connected && sync.netlify.last_error) {
    failures.push({ source: 'Netlify', error: sync.netlify.last_error });
  }
  return failures;
}

function StockAlertsCard({ alerts }: { alerts: DashboardSummary['stock_alerts'] }) {
  const navigate = useNavigate();
  return (
    <section className="brand-alert-warn overflow-hidden">
      <header className="px-4 py-3 flex items-center justify-between border-b border-rose-200">
        <h2 className="text-sm font-medium inline-flex items-center gap-2 brand-alert-warn-strong">
          <AlertTriangle className="h-4 w-4" /> Stock alerts
          <span className="text-xs font-normal opacity-70">
            · projected to fall short before delivery dates
          </span>
        </h2>
        <button
          onClick={() => navigate('/reorder')}
          className="text-xs brand-alert-warn-strong hover:opacity-80 inline-flex items-center gap-0.5"
        >
          Reorder list <ArrowRight className="h-3 w-3" />
        </button>
      </header>
      <ul className="divide-y divide-rose-200">
        {alerts.map((a) => (
          <li key={a.id} className="px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{a.name}</div>
              <div className="text-xs opacity-80">
                short {a.short_by}{a.lowest_date ? ` on ${a.lowest_date}` : ''} · on hand {a.on_hand}, reserved −{a.reserved_total}
              </div>
            </div>
            <div className="text-lg font-serif-brand tabular-nums text-destructive font-medium">
              {a.lowest_projected}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SyncStrip({ sync }: { sync: DashboardSummary['sync'] }) {
  const navigate = useNavigate();
  return (
    <section className="flex flex-wrap gap-2">
      <SourcePill
        label="Stripe"
        connected={sync.stripe.connected}
        when={sync.stripe.last_synced_at}
        error={sync.stripe.last_error}
        onClick={() => navigate('/settings')}
      />
      <SourcePill
        label="Netlify"
        connected={sync.netlify.connected}
        when={sync.netlify.last_synced_at}
        error={sync.netlify.last_error}
        onClick={() => navigate('/settings')}
      />
    </section>
  );
}

function SourcePill({
  label,
  connected,
  when,
  error,
  onClick,
}: {
  label: string;
  connected: boolean;
  when: string | null;
  error: string | null;
  onClick: () => void;
}) {
  // Semantic source pills — sage for healthy, destructive tint for erroring,
  // muted for disconnected.
  const tone = !connected
    ? 'bg-muted text-muted-foreground'
    : error
      ? 'brand-pill-danger'
      : 'brand-pill-ok';
  const Icon = !connected ? XCircle : error ? AlertTriangle : CheckCircle2;
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium">{label}</span>
      <span className="opacity-70 tabular-nums">
        {connected ? `· ${formatDate(when)}` : '· not connected'}
      </span>
    </button>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  sub: string;
  tone?: 'attention' | 'warn';
  onClick?: () => void;
}) {
  // Tones now use rose-tinted alert classes instead of Tailwind orange/blue.
  // Falls through to the brand-surface (subtle paper card) for neutral tiles.
  const toneClass = !tone
    ? 'brand-surface'
    : tone === 'warn'
      ? 'brand-alert-warn'
      : 'brand-alert-info';
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 hover:brightness-[0.98] transition-all ${toneClass}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-4xl font-serif-brand font-medium tabular-nums leading-tight mt-1">
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </button>
  );
}

function RecentOrdersCard({ orders }: { orders: OrderListItem[] }) {
  const navigate = useNavigate();
  return (
    <section className="brand-surface overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium inline-flex items-center gap-2">
          <Receipt className="h-4 w-4" /> Recent orders
        </h2>
        <button
          onClick={() => navigate('/orders')}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          See all <ArrowRight className="h-3 w-3" />
        </button>
      </header>
      {orders.length === 0 ? (
        <EmptyState
          tagline="Quiet day in Bathurst."
          message="No orders yet — the next one'll show up here."
        />
      ) : (
        <ul className="divide-y">
          {orders.map((o) => (
            <li
              key={o.id}
              onClick={() => navigate(`/orders/${o.id}`)}
              className="px-4 py-3 cursor-pointer hover:bg-muted/40 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">
                  {o.customer_name ?? <em className="text-muted-foreground">unknown</em>}
                  {o.recipient && (
                    <span className="text-muted-foreground"> → {o.recipient}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {o.paid_at ? formatDate(o.paid_at) : 'Unpaid'} · {o.app_status} ·{' '}
                  <span className="capitalize">{o.source}</span>
                </div>
              </div>
              <div className="text-sm tabular-nums">{formatCents(o.total_cents)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LowStockCard({ items }: { items: DashboardSummary['low_stock'] }) {
  const navigate = useNavigate();
  return (
    <section className="brand-surface overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium inline-flex items-center gap-2">
          <Boxes className="h-4 w-4" /> Low stock
        </h2>
        <button
          onClick={() => navigate('/inventory')}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          See all <ArrowRight className="h-3 w-3" />
        </button>
      </header>
      {items.length === 0 ? (
        <EmptyState
          tagline="Shelves are stocked."
          message="Everything's above its reorder threshold."
        />
      ) : (
        <ul className="divide-y max-h-80 overflow-auto">
          {items.map((i) => (
            <li
              key={i.id}
              className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{i.name}</div>
                {i.category && (
                  <div className="text-xs text-muted-foreground truncate">{i.category}</div>
                )}
              </div>
              <div className="text-sm tabular-nums">
                <span className="text-destructive font-medium">{i.on_hand}</span>
                <span className="text-muted-foreground"> / {i.reorder_at}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

