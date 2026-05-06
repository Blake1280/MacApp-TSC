import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { trpc } from '../trpc';
import { Input } from '../components/ui/input';
import { formatDate } from '../lib/format';
import type { AuditLogRow, StockMovementReason } from '@shared/types';

const REASONS: Array<{ value: StockMovementReason | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'order_apply', label: 'Order applied' },
  { value: 'order_reverse', label: 'Order reversed' },
  { value: 'opening_balance', label: 'Opening balance' },
  { value: 'restock', label: 'Restock' },
  { value: 'off_site_sale', label: 'Off-site sale' },
  { value: 'manual_adjust', label: 'Manual adjust' },
  { value: 'correction', label: 'Correction' },
];

export default function AuditLogPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState<StockMovementReason | 'all'>('all');
  const rows = trpc.audit.list.useQuery({
    search: search.trim() || undefined,
    reason: reason === 'all' ? undefined : reason,
    limit: 500,
  });

  return (
    <div className="p-8 space-y-5 max-w-6xl">
      <header className="page-h1">
        <h1 className="text-3xl font-serif-brand font-medium leading-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every stock movement, in order. Use this to trace any change in on-hand counts.
        </p>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, name, customer or note"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 flex-wrap">
          {REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={`px-3 py-1 text-xs rounded ${
                reason === r.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">When</th>
              <th className="text-left font-medium px-4 py-2.5">Item</th>
              <th className="text-right font-medium px-4 py-2.5">Δ</th>
              <th className="text-left font-medium px-4 py-2.5">Reason</th>
              <th className="text-left font-medium px-4 py-2.5">Source</th>
              <th className="text-left font-medium px-4 py-2.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {rows.data && rows.data.length === 0 && !rows.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No movements yet.
                </td>
              </tr>
            )}
            {rows.data?.map((r: AuditLogRow) => (
              <tr key={r.id} className="border-t hover:bg-accent/40">
                <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                  {formatDate(r.created_at)}
                </td>
                <td className="px-4 py-2">
                  <div>{r.inventory_name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{r.inventory_sku}</div>
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${
                    r.delta < 0 ? 'text-destructive' : 'text-green-700'
                  }`}
                >
                  {r.delta > 0 ? `+${r.delta}` : r.delta}
                </td>
                <td className="px-4 py-2 text-xs capitalize">{r.reason.replace(/_/g, ' ')}</td>
                <td className="px-4 py-2 text-xs">
                  {r.order_id ? (
                    <button
                      onClick={() => navigate(`/orders/${r.order_id}`)}
                      className="text-primary hover:underline"
                    >
                      Order #{r.order_id}
                      {r.order_customer_name && (
                        <span className="text-muted-foreground"> · {r.order_customer_name}</span>
                      )}
                    </button>
                  ) : r.catalogue_kind ? (
                    <span className="text-muted-foreground capitalize">
                      {r.catalogue_kind}: {r.catalogue_name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[260px]">
                  {r.note ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
