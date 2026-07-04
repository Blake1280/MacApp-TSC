import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ArrowRight, AlertTriangle, Plus, Package, Truck } from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { EmptyState } from '../components/EmptyState';
import { FilterTabs } from '../components/FilterTabs';
import { SyncFailureBanner } from '../components/SyncFailureBanner';
import { formatCents, formatDate } from '../lib/format';
import type {
  CatalogueEntryWithCounts,
  OrderAppStatus,
  OrderListItem,
  OrderMatchStatus,
} from '@shared/types';
import NewManualOrderDialog from './NewManualOrderDialog';

const STATUS_FILTERS: Array<{ value: OrderAppStatus | 'all' | 'review'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'review', label: 'Needs review' },
  { value: 'new', label: 'New' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function OrdersPage() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<OrderAppStatus | 'all' | 'review'>('all');
  const [newOpen, setNewOpen] = useState(false);

  const orders = trpc.orders.list.useQuery({
    search: search.trim() || undefined,
    app_status: filter === 'all' || filter === 'review' ? undefined : filter,
    needs_review_only: filter === 'review' ? true : undefined,
    limit: 200,
  });
  const stripeStatus = trpc.stripe.status.useQuery();
  const netlifyStatus = trpc.netlify.status.useQuery();
  // Pull the catalogue once so we can render finish/palette/design names
  // instead of their technical external_ids in the order list.
  const catalogue = trpc.catalogue.list.useQuery({ includeArchived: true });
  const nameByExtId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of (catalogue.data ?? []) as CatalogueEntryWithCounts[]) {
      m.set(`${e.kind}:${e.external_id}`, e.name);
    }
    return m;
  }, [catalogue.data]);
  const runAll = trpc.sync.runAll.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.stripe.status.invalidate();
      utils.netlify.status.invalidate();
    },
  });

  const navigate = useNavigate();

  return (
    <div className="p-8 space-y-5 max-w-6xl">
      <header className="flex items-center justify-between gap-4">
        <div className="page-h1">
          <h1 className="text-3xl font-serif-brand font-medium leading-tight">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every order from the website plus any you've added by hand. Click one to see the
            details and deduct stock when you're ready to make it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            Stripe: {formatDate(stripeStatus.data?.last_synced_at)}
            {' · '}
            Netlify: {formatDate(netlifyStatus.data?.last_synced_at)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runAll.mutate()}
            disabled={runAll.isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${runAll.isLoading ? 'animate-spin' : ''}`} />
            Sync now
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Manual order
          </Button>
        </div>
      </header>

      {!stripeStatus.data?.connected && !netlifyStatus.data?.connected && (
        <div className="rounded-lg border border-dashed border-rose-200 bg-card/60 p-6 text-center text-sm space-y-2">
          <p className="font-medium">No order sources connected yet.</p>
          <p className="text-muted-foreground">
            Go to <strong>Settings</strong> and connect Stripe and/or Netlify. You can also create
            a <strong>Manual order</strong> for any sale right now.
          </p>
        </div>
      )}

      <SyncFailureBanner
        failures={[
          ...(stripeStatus.data?.connected && stripeStatus.data?.last_error
            ? [{ source: 'Stripe', error: stripeStatus.data.last_error }]
            : []),
          ...(netlifyStatus.data?.connected && netlifyStatus.data?.last_error
            ? [{ source: 'Netlify', error: netlifyStatus.data.last_error }]
            : []),
        ]}
        onRetry={() => runAll.mutate()}
        retrying={runAll.isLoading}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, recipient or session id"
            className="pl-9"
          />
        </div>
        <FilterTabs options={STATUS_FILTERS} value={filter} onChange={setFilter} />
      </div>

      <div className="brand-surface overflow-hidden">
        <table className="w-full text-sm table-sticky">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-3">Paid</th>
              <th className="text-left font-medium px-4 py-3">Needed</th>
              <th className="text-left font-medium px-4 py-3">Customer</th>
              <th className="text-left font-medium px-4 py-3">Recipient · Occasion</th>
              <th className="text-left font-medium px-4 py-3">Customisation</th>
              <th className="text-right font-medium px-4 py-3">Total</th>
              <th className="text-left font-medium px-4 py-3">Status</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {orders.isLoading && (
              <tr>
                <td colSpan={8}>
                  <EmptyState loading />
                </td>
              </tr>
            )}
            {orders.data && orders.data.length === 0 && !orders.isLoading && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    tagline="Quiet day in Bathurst."
                    message="No orders yet — they'll show up here as they come in."
                  />
                </td>
              </tr>
            )}
            {orders.data?.map((o: OrderListItem) => (
              <tr
                key={o.id}
                className="border-t hover:bg-accent/40 cursor-pointer"
                onClick={() => navigate(`/orders/${o.id}`)}
              >
                <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                  {o.paid_at ? (
                    formatDate(o.paid_at)
                  ) : (
                    <span className="inline-flex items-center gap-1" style={{ color: 'hsl(var(--rose-700))' }}>
                      <AlertTriangle className="h-3 w-3" /> Unpaid
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs tabular-nums">
                  <NeededCell dateNeeded={o.date_needed} timeNeeded={o.time_needed} deliveryZone={o.delivery_zone} />
                </td>
                <td className="px-4 py-2.5">
                  <div>{o.customer_name ?? <em className="text-muted-foreground">unknown</em>}</div>
                  <div className="text-xs text-muted-foreground">{o.customer_email ?? ''}</div>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  <div>{o.recipient ?? '—'}</div>
                  <div className="text-muted-foreground">{o.occasion ?? ''}</div>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  <CustomisationCell order={o} nameByExtId={nameByExtId} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatCents(o.total_cents)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadges
                    app={o.app_status}
                    match={o.match_status}
                    stockApplied={o.stock_applied === 1}
                    manuallyMarkedPaid={o.manually_marked_paid === 1}
                    paid={!!o.paid_at}
                    source={o.source}
                  />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {newOpen && <NewManualOrderDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function NeededCell({
  dateNeeded,
  timeNeeded,
  deliveryZone,
}: {
  dateNeeded: string | null;
  timeNeeded: string | null;
  deliveryZone: string | null;
}) {
  if (!dateNeeded) {
    return <span className="text-muted-foreground">—</span>;
  }
  const dateObj = new Date(dateNeeded);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((dateObj.getTime() - today.getTime()) / 86400000);
  const urgent = days >= 0 && days <= 2;
  const overdue = days < 0;

  // Pretty-format DD/MM (drop year — Jade can see it on the order detail)
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');

  // Pickup vs delivery icon as a one-glance signal.
  const isPickup = deliveryZone === 'pickup';
  const Icon = isPickup ? Package : Truck;

  return (
    <div>
      <div
        className={`inline-flex items-center gap-1 ${
          overdue
            ? 'text-destructive font-medium'
            : urgent
              ? 'text-warning-deep font-medium'
              : 'text-foreground'
        }`}
      >
        <Icon className="h-3 w-3" />
        {dd}/{mm}
        {timeNeeded && <span className="text-muted-foreground">· {timeNeeded}</span>}
      </div>
      {days >= 0 && (
        <div className="text-muted-foreground text-[10px]">
          {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
        </div>
      )}
      {overdue && (
        <div className="text-destructive text-[10px] font-medium">
          {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago
        </div>
      )}
    </div>
  );
}

function CustomisationCell({
  order,
  nameByExtId,
}: {
  order: OrderListItem;
  nameByExtId: Map<string, string>;
}) {
  // Bundle orders: lead with the bundle name. Locked addons + trim are
  // already implied; we surface the gift count so Jade can spot at a glance
  // how much is in the box.
  if (order.flow_type === 'bundle' && order.bundle_name) {
    const lockedCount = order.locked_addons_csv
      ? order.locked_addons_csv.split(',').filter(Boolean).length
      : 0;
    const totalGifts = lockedCount + order.addon_count;
    return (
      <div>
        <div className="font-medium text-foreground inline-flex items-center gap-1">
          <Package className="h-3 w-3" />
          {order.bundle_name}
        </div>
        {totalGifts > 0 && (
          <div className="text-muted-foreground">
            {totalGifts} gift{totalGifts === 1 ? '' : 's'} inside
          </div>
        )}
      </div>
    );
  }

  // BYO: prefer human names over slugs. Fall back to the slug only if the
  // catalogue hasn't been imported yet.
  const designName = order.design_slug
    ? nameByExtId.get(`design:${order.design_slug}`) ?? order.design_slug
    : null;
  const finishName = order.finish_id
    ? nameByExtId.get(`finish:${order.finish_id}`) ?? order.finish_id
    : null;
  const paletteName = order.palette_id
    ? nameByExtId.get(`palette:${order.palette_id}`) ?? order.palette_id
    : null;

  const parts = [designName, finishName, paletteName].filter(Boolean);
  return (
    <div>
      <div>
        {parts.length > 0 ? parts.join(' · ') : <em className="text-muted-foreground">Custom build</em>}
      </div>
      {order.addon_count > 0 && (
        <div className="text-muted-foreground">
          + {order.addon_count} add-on{order.addon_count === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function StatusBadges({
  app,
  match,
  stockApplied,
  manuallyMarkedPaid,
  paid,
  source,
}: {
  app: OrderAppStatus;
  match: OrderMatchStatus;
  stockApplied: boolean;
  manuallyMarkedPaid: boolean;
  paid: boolean;
  source: 'stripe' | 'netlify' | 'manual';
}) {
  // Brand-toned status pills — re-skinned from Tailwind's blue/green/orange
  // wheel onto rose/cream/blush so the table reads as one composition. The
  // shapes match the new `.brand-pill-*` classes in styles.css.
  const appPill: Record<OrderAppStatus, string> = {
    new: 'brand-pill-new',
    confirmed: 'brand-pill-confirmed',
    fulfilled: 'brand-pill-fulfilled',
    cancelled: 'brand-pill-cancelled',
    refunded: 'brand-pill-refunded',
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className={`brand-pill capitalize ${appPill[app]}`}>{app}</span>
      <span
        className="brand-pill"
        title={`Match status: ${match.replace(/_/g, ' ')}`}
      >
        {source}
      </span>
      {!paid && <span className="brand-pill brand-pill-refunded">unpaid</span>}
      {manuallyMarkedPaid && (
        <span className="brand-pill brand-pill-new">manually paid</span>
      )}
      {stockApplied && (
        <span className="brand-pill brand-pill-confirmed">stock applied</span>
      )}
    </div>
  );
}

