import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingDown, AlertTriangle, ChevronRight, Wrench } from 'lucide-react';
import { trpc } from '../trpc';
import { formatCents, formatDate } from '../lib/format';
import { FilterTabs } from '../components/FilterTabs';
import { EmptyState } from '../components/EmptyState';

type Tab = 'bundle' | 'order';
type Range = 'all' | '7' | '30' | '90';

function rangeToFromTo(r: Range): { from?: string; to?: string } {
  if (r === 'all') return {};
  const days = parseInt(r, 10);
  const d = new Date();
  d.setDate(d.getDate() - days);
  const iso = d.toISOString().slice(0, 10);
  return { from: iso };
}

export default function MarginsPage() {
  const [tab, setTab] = useState<Tab>('bundle');
  const [range, setRange] = useState<Range>('30');

  const filter = useMemo(() => rangeToFromTo(range), [range]);
  const byBundle = trpc.margins.byBundle.useQuery(filter, { enabled: tab === 'bundle' });
  const byOrder = trpc.margins.byOrder.useQuery({ ...filter, limit: 100 }, { enabled: tab === 'order' });
  const health = trpc.inventory.dataHealth.useQuery();

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="page-h1">
        <h1 className="text-3xl font-serif-brand font-medium leading-tight inline-flex items-center gap-3">
          <TrendingDown className="h-7 w-7 text-rose-600" /> Margins
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          What's actually making money. Cost uses the cheapest supplier price, then the item's recorded cost
          when no supplier price exists. Missing costs are flagged so you know which margins still need work.
        </p>
      </header>

      {health.data && (health.data.cogsAffectingItems.length > 0 || health.data.addonsMissingRecipes.length > 0) && (
        <DataHealthBanner
          missingPrices={health.data.cogsAffectingItems}
          missingRecipes={health.data.addonsMissingRecipes}
        />
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <FilterTabs<Tab>
          options={[
            { value: 'bundle', label: 'By bundle' },
            { value: 'order', label: 'By order' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="ml-auto">
          <FilterTabs<Range>
            options={(['7', '30', '90', 'all'] as const).map((r) => ({
              value: r,
              label: r === 'all' ? 'All time' : `Last ${r}d`,
            }))}
            value={range}
            onChange={setRange}
          />
        </div>
      </div>

      {tab === 'bundle' ? (
        <BundleTable
          loading={byBundle.isLoading}
          rows={(byBundle.data as BundleRow[] | undefined) ?? []}
        />
      ) : (
        <OrderTable
          loading={byOrder.isLoading}
          rows={(byOrder.data as OrderRow[] | undefined) ?? []}
        />
      )}
    </div>
  );
}

type BundleRow = {
  bundle_id: string | null;
  bundle_name: string | null;
  flow_type: 'byo' | 'bundle';
  order_count: number;
  total_revenue_cents: number;
  total_cogs_cents: number;
  total_margin_cents: number;
  avg_revenue_cents: number;
  avg_cogs_cents: number;
  avg_margin_cents: number;
  unknown_items_count: number;
};

type OrderRow = {
  order_id: number;
  paid_at: string | null;
  customer_name: string | null;
  flow_type: 'byo' | 'bundle';
  bundle_name: string | null;
  total_cents: number;
  cogs_cents: number;
  margin_cents: number;
  unknown_items_count: number;
};

function BundleTable({ loading, rows }: { loading: boolean; rows: BundleRow[] }) {
  if (loading) return <EmptyState loading surface />;
  if (rows.length === 0) return <EmptyState surface message="No orders in this range." />;
  return (
    <div className="brand-surface overflow-hidden">
      <table className="w-full text-sm table-sticky">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Bundle</th>
            <th className="text-right px-4 py-2.5 font-medium">Orders</th>
            <th className="text-right px-4 py-2.5 font-medium">Avg sale</th>
            <th className="text-right px-4 py-2.5 font-medium">Avg COGS</th>
            <th className="text-right px-4 py-2.5 font-medium">Avg margin</th>
            <th className="text-right px-4 py-2.5 font-medium">Margin %</th>
            <th className="text-left px-4 py-2.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const pct = r.avg_revenue_cents > 0
              ? Math.round((r.avg_margin_cents / r.avg_revenue_cents) * 100)
              : null;
            const negative = r.avg_margin_cents < 0;
            return (
              <tr key={`${r.flow_type}:${r.bundle_id ?? 'byo'}`} className="hover:bg-accent/30">
                <td className="px-4 py-2.5">
                  <div className="font-medium">
                    {r.flow_type === 'bundle'
                      ? r.bundle_name ?? <em className="text-muted-foreground">{r.bundle_id}</em>
                      : 'BYO orders'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.flow_type === 'bundle' ? r.bundle_id : 'flow_type=byo'}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.order_count}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(r.avg_revenue_cents)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(r.avg_cogs_cents)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${negative ? 'text-destructive' : ''}`}>
                  {formatCents(r.avg_margin_cents)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${negative ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {pct !== null ? `${pct}%` : '—'}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {r.unknown_items_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-warning-deep">
                      <AlertTriangle className="h-3 w-3" />
                      {r.unknown_items_count} line{r.unknown_items_count === 1 ? '' : 's'} missing price
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ loading, rows }: { loading: boolean; rows: OrderRow[] }) {
  const navigate = useNavigate();
  if (loading) return <EmptyState loading surface />;
  if (rows.length === 0) return <EmptyState surface message="No orders in this range." />;
  return (
    <div className="brand-surface overflow-hidden">
      <table className="w-full text-sm table-sticky">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Order</th>
            <th className="text-left px-4 py-2.5 font-medium">When</th>
            <th className="text-right px-4 py-2.5 font-medium">Sale</th>
            <th className="text-right px-4 py-2.5 font-medium">COGS</th>
            <th className="text-right px-4 py-2.5 font-medium">Margin</th>
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const negative = r.margin_cents < 0;
            return (
              <tr
                key={r.order_id}
                onClick={() => navigate(`/orders/${r.order_id}`)}
                className="hover:bg-accent/30 cursor-pointer"
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium truncate">
                    {r.customer_name ?? <em className="text-muted-foreground">unknown</em>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.flow_type === 'bundle' ? (r.bundle_name ?? 'Bundle') : 'BYO'}
                    {r.unknown_items_count > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-warning-deep">
                        <AlertTriangle className="h-3 w-3" />
                        {r.unknown_items_count} unpriced
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {formatDate(r.paid_at)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(r.total_cents)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(r.cogs_cents)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${negative ? 'text-destructive' : ''}`}>
                  {formatCents(r.margin_cents)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataHealthBanner({
  missingPrices,
  missingRecipes,
}: {
  missingPrices: Array<{ id: number; sku: string; name: string }>;
  missingRecipes: Array<{ id: number; external_id: string; name: string }>;
}) {
  const navigate = useNavigate();
  return (
    <section className="brand-alert-warn px-4 py-3">
      <div className="flex items-start gap-3">
        <Wrench className="h-5 w-5 brand-alert-warn-strong mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="text-sm font-medium brand-alert-warn-strong">Margins are noisy until you fix this</div>
          <ul className="text-xs opacity-80 space-y-1">
            {missingPrices.length > 0 && (
              <li>
                <strong>{missingPrices.length}</strong> recipe item{missingPrices.length === 1 ? ' has' : 's have'} no
                supplier price yet — COGS undercounts by their cost.
                <button
                  onClick={() => navigate('/inventory')}
                  className="ml-2 underline hover:no-underline"
                >
                  Add prices on Stock
                </button>
              </li>
            )}
            {missingRecipes.length > 0 && (
              <li>
                <strong>{missingRecipes.length}</strong> add-on{missingRecipes.length === 1 ? '' : 's'} ha{missingRecipes.length === 1 ? 's' : 've'} no recipe — bundles containing {missingRecipes.length === 1 ? 'it' : 'them'} won't deduct that stock or count its cost.
                <button
                  onClick={() => navigate('/products')}
                  className="ml-2 underline hover:no-underline"
                >
                  Open Catalogue
                </button>
                <span className="text-warning-deep opacity-60 ml-1">
                  ({missingRecipes.slice(0, 3).map((r) => r.name).join(', ')}
                  {missingRecipes.length > 3 ? `, +${missingRecipes.length - 3} more` : ''})
                </span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
