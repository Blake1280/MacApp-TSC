import { useState } from 'react';
import { ShoppingCart, ExternalLink, Copy, CheckCircle2 } from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/EmptyState';
import { formatCents } from '../lib/format';

type ReorderItem = {
  inventory_item_id: number;
  sku: string;
  name: string;
  unit: string;
  on_hand: number;
  reorder_at: number;
  shortfall: number;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_url: string | null;
  unit_price_cents: number | null;
  photo_url: string | null;
  is_preferred: number | null;
};

type ReorderGroup = {
  supplier_group: string;
  items: ReorderItem[];
};

export default function ReorderPage() {
  const list = trpc.inventory.reorderList.useQuery() as unknown as {
    data?: ReorderGroup[];
    isLoading: boolean;
  };
  const openUrl = trpc.suppliers.openUrl.useMutation();

  const groups = list.data ?? [];
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="page-h1">
        <h1 className="text-3xl font-serif-brand font-medium leading-tight inline-flex items-center gap-3">
          <ShoppingCart className="h-7 w-7 text-rose-600" /> Reorder
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {totalItems === 0
            ? 'Nothing below reorder threshold.'
            : `${totalItems} item${totalItems === 1 ? '' : 's'} to reorder, grouped by supplier.`}
        </p>
      </header>

      {list.isLoading && <EmptyState loading surface />}

      {!list.isLoading && groups.length === 0 && (
        <EmptyState
          surface
          tagline="Shelves are stocked."
          message="Everything is above its reorder threshold."
        />
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <SupplierCard key={g.supplier_group} group={g} onOpen={(url) => openUrl.mutate({ url })} />
        ))}
      </div>
    </div>
  );
}

function SupplierCard({
  group,
  onOpen,
}: {
  group: ReorderGroup;
  onOpen: (url: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const hasUrls = group.items.some((i) => i.supplier_url);
  const isUnlinked = group.supplier_group.startsWith('—');

  function openAll() {
    const urls = new Set<string>();
    for (const i of group.items) if (i.supplier_url) urls.add(i.supplier_url);
    for (const u of urls) onOpen(u);
  }

  function copyList() {
    const lines = group.items.map((i) =>
      [i.sku, i.name, `qty ${i.shortfall}`, i.unit_price_cents != null ? formatCents(i.unit_price_cents) : '—', i.supplier_url ?? '']
        .join('\t'),
    );
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="brand-surface overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <h2 className={`text-sm font-medium ${isUnlinked ? 'text-muted-foreground' : ''}`}>
          {group.supplier_group}
          <span className="text-xs text-muted-foreground ml-2">
            · {group.items.length} item{group.items.length === 1 ? '' : 's'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyList}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy list'}
          </Button>
          {hasUrls && !isUnlinked && (
            <Button size="sm" onClick={openAll}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open all
            </Button>
          )}
        </div>
      </header>
      <ul className="divide-y">
        {group.items.map((i) => (
          <li key={i.inventory_item_id} className="px-4 py-3 flex items-center gap-3">
            <Thumb src={i.photo_url} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{i.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {i.supplier_name ?? <em>No supplier linked yet</em>}
              </div>
            </div>
            <div className="text-right text-xs tabular-nums">
              <div>
                <span className="text-destructive font-medium">{i.on_hand}</span>
                <span className="text-muted-foreground"> / {i.reorder_at}</span>
              </div>
              <div className="text-muted-foreground">order {i.shortfall}+</div>
            </div>
            <div className="text-sm tabular-nums w-20 text-right">
              {i.unit_price_cents != null ? formatCents(i.unit_price_cents) : '—'}
            </div>
            {i.supplier_url ? (
              <Button variant="outline" size="sm" onClick={() => onOpen(i.supplier_url!)}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
            ) : (
              <div className="w-[72px]" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Thumb({ src }: { src: string | null }) {
  if (!src) {
    return <div className="h-12 w-12 rounded bg-muted shrink-0" />;
  }
  return (
    <div className="h-12 w-12 rounded bg-white border shrink-0 overflow-hidden flex items-center justify-center">
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full object-contain"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );
}

