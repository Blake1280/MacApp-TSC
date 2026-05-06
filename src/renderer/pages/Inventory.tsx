import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Search,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Pencil,
  Archive,
  ArchiveRestore,
  ExternalLink,
  ShoppingCart,
  PackageCheck,
  PackageX,
} from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import type { InventoryItem, StockMovement, StockMovementReason, SupplierSource } from '@shared/types';
import { formatCents, formatDate } from '../lib/format';
import { usePrefs } from '../lib/prefs';

type AdjustMode = {
  item: InventoryItem;
  reason: StockMovementReason;
  signHint: 'add' | 'subtract';
  title: string;
};

const UNCATEGORISED = 'Uncategorised';

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  // null while we wait for the first data load — once items arrive we pick
  // a sensible default tab (Low stock if any, else the first category).
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [adjust, setAdjust] = useState<AdjustMode | null>(null);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  // Server-side low-stock filter — only fires when the Low stock tab is selected.
  const lowStockOnly = activeCategory === 'Low stock';

  const items = trpc.inventory.list.useQuery({
    search: search.trim() || undefined,
    lowStockOnly,
    includeArchived: showArchived,
  });

  // Forward-looking reservations for the next 30 days. Used to render the
  // Reserved column + "short" badge on rows where pending orders will dip
  // on_hand below zero.
  const projection = trpc.inventory.projection.useQuery({ horizon_days: 30 });
  const projectionByItem = useMemo(() => {
    const map = new Map<number, NonNullable<typeof projection.data>[number]>();
    for (const p of projection.data ?? []) map.set(p.inventory_item_id, p);
    return map;
  }, [projection.data]);

  // Group items by category — mirrors the per-tab structure of the stocktake spreadsheet.
  // Uncategorised items go into a sentinel bucket at the end.
  const grouped = useMemo(() => {
    const all = items.data ?? [];
    const map = new Map<string, InventoryItem[]>();
    for (const item of all) {
      const cat = (item.category && item.category.trim()) || UNCATEGORISED;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    // Stable category order: alphabetical, with Uncategorised pushed to the bottom
    const categories = [...map.keys()].sort((a, b) => {
      if (a === UNCATEGORISED) return 1;
      if (b === UNCATEGORISED) return -1;
      return a.localeCompare(b);
    });
    return { all, categories, map };
  }, [items.data]);

  const lowStockCount = useMemo(
    () => grouped.all.filter((i) => i.on_hand <= i.reorder_at && i.reorder_at > 0).length,
    [grouped.all],
  );

  // Auto-select a sensible default tab once data lands. If there are low-stock
  // items, prefer that — they're what Jade probably wants to see first. Else
  // 'All' so every category is visible at landing rather than burying
  // non-balloon categories behind a horizontally-scrolling tab strip.
  // Wrapped in useEffect so we don't call setState during render (React 18
  // flags that as an "Cannot update a component while rendering" warning
  // and causes a flicker when the categories first load).
  useEffect(() => {
    if (activeCategory === null && grouped.categories.length > 0) {
      setActiveCategory(lowStockCount > 0 ? 'Low stock' : 'All');
    }
  }, [activeCategory, grouped.categories.length, lowStockCount]);

  const visibleCategories = (() => {
    if (activeCategory === 'All' || activeCategory === 'Low stock') return grouped.categories;
    if (activeCategory && grouped.map.has(activeCategory)) return [activeCategory];
    return grouped.categories;
  })();

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between gap-4">
        <div className="page-h1">
          <h1 className="text-3xl font-serif-brand font-medium leading-tight">Stock</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What's on the shelf right now. Click a category chip to focus, or use the search.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New item
        </Button>
      </header>

      {/* Search + show-archived sit on a single row above the tabs. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className="pl-9"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
            showArchived
              ? 'border-muted-foreground/40 bg-muted text-foreground'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      </div>

      {/* Category tabs — horizontal scroll on overflow. Only one section
          renders at a time so the page stays decluttered. */}
      {grouped.categories.length > 0 && (
        <div className="border-b overflow-x-auto -mx-1">
          <div className="flex items-center gap-0.5 px-1 min-w-max">
            <CategoryTab
              label="All"
              count={grouped.all.length}
              active={activeCategory === 'All'}
              onClick={() => setActiveCategory('All')}
            />
            {lowStockCount > 0 && (
              <CategoryTab
                label="Low stock"
                count={lowStockCount}
                active={activeCategory === 'Low stock'}
                onClick={() => setActiveCategory('Low stock')}
                tone="warn"
              />
            )}
            {grouped.categories.map((cat) => (
              <CategoryTab
                key={cat}
                label={cat}
                count={grouped.map.get(cat)!.length}
                active={activeCategory === cat}
                onClick={() => setActiveCategory(cat)}
              />
            ))}
          </div>
        </div>
      )}

      {items.isLoading && (
        <div className="brand-surface px-4 py-8 text-center text-muted-foreground">Loading…</div>
      )}

      {items.data && items.data.length === 0 && (
        <div className="brand-surface px-4 py-12 text-center text-muted-foreground">
          No inventory yet. Click <strong>New item</strong> or import the stocktake spreadsheet from the Products page to get started.
        </div>
      )}

      {visibleCategories.map((category) => {
        const list = grouped.map.get(category)!;
        return (
          <section key={category} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-medium">{category}</h2>
              <span className="text-xs text-muted-foreground">({list.length})</span>
            </div>
            <div className="brand-surface overflow-hidden">
              <table className="w-full text-sm table-sticky">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Item</th>
                    <th className="text-right font-medium px-4 py-3 w-28">On hand</th>
                    <th className="text-right font-medium px-4 py-3 w-32">Reserved</th>
                    <th className="text-right font-medium px-4 py-3 w-20">Reorder at</th>
                    <th className="text-right font-medium px-4 py-3 w-20">Cost</th>
                    <th className="text-left font-medium px-4 py-3 w-48">Reorder from</th>
                    <th className="text-right font-medium px-4 py-3 w-72">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((item) => (
                    <StockRow
                      key={item.id}
                      item={item}
                      projection={projectionByItem.get(item.id) ?? null}
                      onAdjust={(mode) => setAdjust({ ...mode, item })}
                      onEdit={() => setEditItem(item)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} />}
      {adjust && <AdjustDialog mode={adjust} onClose={() => setAdjust(null)} />}
      {editItem && <EditDialog item={editItem} onClose={() => setEditItem(null)} />}
    </div>
  );
}

type ProjectionRow = {
  inventory_item_id: number;
  reserved_total: number;
  lowest_projected: number;
  lowest_date: string | null;
  short_by: number;
};

function StockRow({
  item,
  projection,
  onAdjust,
  onEdit,
}: {
  item: InventoryItem;
  projection: ProjectionRow | null;
  onAdjust: (mode: Omit<AdjustMode, 'item'>) => void;
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const update = trpc.inventory.update.useMutation({
    onSuccess: () => utils.inventory.list.invalidate(),
  });
  const isArchived = item.archived === 1;
  // Items default to stock_tracked=1 (legacy + everything pre-migration-018).
  // 0 = per-order: Jade orders as customers ask. Hidden from website push so
  // these tiles never black out for being at zero.
  const isPerOrder = item.stock_tracked === 0;
  const low =
    !isArchived &&
    !isPerOrder &&
    item.on_hand <= item.reorder_at &&
    item.reorder_at > 0;

  function toggleArchive() {
    const verb = isArchived ? 'restore' : 'archive';
    if (
      isArchived ||
      window.confirm(
        `Archive "${item.name}"?\n\n` +
          `Archived items hide from the Stock page and the next stocktake export. ` +
          `Stock movements are preserved — you can always restore the item later.`,
      )
    ) {
      update.mutate({ id: item.id, archived: isArchived ? 0 : 1 });
    } else {
      // user cancelled
      void verb;
    }
  }

  function togglePerOrder() {
    update.mutate({ id: item.id, stock_tracked: isPerOrder ? 1 : 0 });
  }

  return (
    <tr className={`border-t ${isArchived ? 'opacity-60' : 'hover:bg-accent/40'}`}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {item.photo_url ? (
            <img
              src={item.photo_url}
              alt=""
              // Larger thumbnail (48×48) + object-contain so the full balloon
              // fits regardless of how much whitespace the source image has.
              // White background helps balloon swatches with transparent
              // backgrounds read clearly without dimming the colour.
              className="h-12 w-12 rounded object-contain flex-shrink-0 border border-border bg-white p-0.5"
              loading="lazy"
              onError={(e) => {
                // Hide broken images quietly — supplier CDNs sometimes change URLs.
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{item.name}</span>
              {isArchived && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                  archived
                </span>
              )}
              {isPerOrder && !isArchived && (
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200"
                  title="Per-order — Jade orders this in as customers request it. Won't black out on the website at on_hand=0."
                >
                  per-order
                </span>
              )}
            </div>
            {item.notes && (
              <div className="text-xs text-muted-foreground truncate max-w-md mt-0.5">
                {item.notes}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        <span
          className={
            low ? 'text-destructive font-medium inline-flex items-center gap-1' : ''
          }
        >
          {low && <AlertTriangle className="h-3.5 w-3.5" />}
          {item.on_hand} {item.unit !== 'each' ? item.unit : ''}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
        {projection && projection.reserved_total > 0 ? (
          <div className="flex flex-col items-end gap-0.5">
            <span>−{projection.reserved_total}</span>
            {projection.short_by > 0 && projection.lowest_date && (
              <span
                className="text-[10px] text-destructive font-medium uppercase tracking-wide"
                title={`Projected to be short ${projection.short_by} on ${projection.lowest_date}`}
              >
                short {projection.short_by}
              </span>
            )}
          </div>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
        {item.reorder_at}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
        {formatCents(item.cost_cents)}
      </td>
      <td className="px-4 py-2.5">
        <ReorderCell itemId={item.id} itemName={item.name} disabled={isArchived} />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end gap-1">
          {!isArchived && (
            <>
              <Button
                size="sm"
                variant="ghost"
                title="Add stock (restock)"
                onClick={() =>
                  onAdjust({
                    reason: 'restock',
                    signHint: 'add',
                    title: `Restock — ${item.name}`,
                  })
                }
              >
                <ArrowUpCircle className="h-4 w-4" /> Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Record off-site sale"
                onClick={() =>
                  onAdjust({
                    reason: 'off_site_sale',
                    signHint: 'subtract',
                    title: `Off-site sale — ${item.name}`,
                  })
                }
              >
                <ArrowDownCircle className="h-4 w-4" /> Sale
              </Button>
              <Button size="sm" variant="ghost" title="Edit details" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title={
                  isPerOrder
                    ? 'Mark as stock-tracked — on_hand will drive website availability + low-stock alerts again'
                    : "Mark as per-order — Jade orders this in per customer request. Won't black out on the website at on_hand=0."
                }
                onClick={togglePerOrder}
                disabled={update.isLoading}
              >
                {isPerOrder ? (
                  <PackageCheck className="h-4 w-4" />
                ) : (
                  <PackageX className="h-4 w-4" />
                )}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            title={isArchived ? 'Restore' : 'Archive (hides from list, keeps history)'}
            onClick={toggleArchive}
            disabled={update.isLoading}
          >
            {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Reorder cell on the Stock page row. Reads supplier sources via tRPC and
 * shows a dropdown sorted cheapest-known-first. Click a row → app opens
 * the URL in the user's default browser via shell.openExternal.
 *
 * If the item has no suppliers configured, shows a subtle "Add supplier"
 * action that defers to the Edit dialog.
 */
/**
 * Reorder cell on the Stock page. Trigger button + popover dropdown.
 *
 * Dropdown layout:
 *   - Sources are grouped by primary supplier (the part before " — ").
 *     E.g. "OPS — Gold", "OPS — Silver", "OPS — Rose Gold" all collapse
 *     under one "OPS" group. Variant chips list the colour/letter/etc.
 *   - Linked groups come first (cheapest known overall first), then
 *     unlinked groups with an inline + Add link affordance per row.
 *   - Each row carries a thumbnail when one's set on the supplier source
 *     (per-colour swatches for foil letters; product image for latex).
 */
function ReorderCell({
  itemId,
  itemName,
  disabled,
}: {
  itemId: number;
  itemName: string;
  disabled: boolean;
}) {
  const utils = trpc.useUtils();
  const sources = trpc.suppliers.forItem.useQuery({ inventory_item_id: itemId });
  const openUrl = trpc.suppliers.openUrl.useMutation();
  const updateMut = trpc.suppliers.update.useMutation({
    onSuccess: () => utils.suppliers.forItem.invalidate({ inventory_item_id: itemId }),
  });
  const [open, setOpen] = useState(false);
  const [linkingSourceId, setLinkingSourceId] = useState<number | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const list = sources.data ?? [];
  const cheapest = list.find((s) => s.url) ?? list[0];

  if (disabled) return <span className="text-xs text-muted-foreground">—</span>;

  if (list.length === 0) {
    return <span className="text-xs text-muted-foreground italic">No supplier yet</span>;
  }

  function go(url: string | null | undefined) {
    if (!url) return;
    openUrl.mutate({ url });
    setOpen(false);
  }

  function saveLink(sourceId: number) {
    const trimmed = linkDraft.trim();
    if (!trimmed) {
      setLinkingSourceId(null);
      return;
    }
    updateMut.mutate(
      { id: sourceId, url: trimmed },
      {
        onSuccess: () => {
          setLinkingSourceId(null);
          setLinkDraft('');
        },
      },
    );
  }

  // ---------- Compact triggers (single supplier) ----------

  if (list.length === 1 && cheapest.url) {
    return (
      <button
        type="button"
        onClick={() => go(cheapest.url)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:border-primary hover:bg-accent/40 hover:text-foreground transition-colors max-w-full"
        title={`Open ${cheapest.supplier_name} in your browser`}
      >
        <ShoppingCart className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{cheapest.supplier_name}</span>
        {cheapest.unit_price_cents != null && (
          <span className="text-muted-foreground tabular-nums font-normal">
            {formatCents(cheapest.unit_price_cents)}
          </span>
        )}
        <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
      </button>
    );
  }

  if (list.length === 1 && !cheapest.url) {
    if (linkingSourceId === cheapest.id) {
      return (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            type="url"
            placeholder="https://..."
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLink(cheapest.id);
              if (e.key === 'Escape') {
                setLinkingSourceId(null);
                setLinkDraft('');
              }
            }}
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => saveLink(cheapest.id)}
            disabled={updateMut.isLoading}
          >
            Save
          </Button>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground italic truncate">
          {cheapest.supplier_name} — not linked
        </span>
        <button
          type="button"
          onClick={() => {
            setLinkingSourceId(cheapest.id);
            setLinkDraft('');
          }}
          className="text-rose-700 hover:underline whitespace-nowrap"
        >
          + Add link
        </button>
      </div>
    );
  }

  // ---------- Multi-supplier dropdown ----------

  // Group sources by primary supplier name (everything before " — ").
  const groups = groupSuppliers(list);
  const linkedGroupNames = groups.linkedOrder;
  const unlinkedGroupNames = groups.unlinkedOrder;
  const hasUnlinked = unlinkedGroupNames.length > 0;

  return (
    <div className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors max-w-full ${
          open
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card hover:border-primary hover:bg-accent/40'
        }`}
        title={`${list.length} options across ${linkedGroupNames.length + unlinkedGroupNames.length} suppliers`}
      >
        <ShoppingCart className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">Reorder</span>
        <span className="text-[10px] opacity-70">▾</span>
      </button>

      <Popover triggerRef={triggerRef} open={open} onClose={() => setOpen(false)} width={380}>
        <div className="px-3.5 py-2.5 border-b bg-muted/30 sticky top-0 z-[1]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reorder</div>
          <div className="text-sm font-medium truncate">{itemName}</div>
        </div>

        {linkedGroupNames.map((group) => (
          <SupplierGroup
            key={`L-${group}`}
            groupName={group}
            sources={groups.byPrimary.get(group)!.filter((s) => s.url)}
            onPick={(url) => go(url)}
          />
        ))}

        {hasUnlinked && (
          <div className="border-t bg-muted/10">
            <div className="px-3.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Suppliers without a saved link
            </div>
            {unlinkedGroupNames.map((group) =>
              groups.byPrimary.get(group)!.filter((s) => !s.url).map((s) => (
                <UnlinkedSupplierRow
                  key={`U-${s.id}`}
                  source={s}
                  editing={linkingSourceId === s.id}
                  draft={linkDraft}
                  onStartEdit={() => {
                    setLinkingSourceId(s.id);
                    setLinkDraft('');
                  }}
                  onDraftChange={setLinkDraft}
                  onCancel={() => {
                    setLinkingSourceId(null);
                    setLinkDraft('');
                  }}
                  onSave={() => saveLink(s.id)}
                  saving={updateMut.isLoading}
                />
              )),
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}

/**
 * Portaled popover that anchors to a trigger element via getBoundingClientRect.
 * Renders into document.body so it escapes any parent overflow:hidden clipping
 * (matters for the Reorder dropdown which lives inside the Stock table's
 * rounded-overflow-hidden card).
 *
 * Behaviour:
 *  - Default position: directly under the trigger, left-aligned to it.
 *  - Flips ABOVE the trigger when there isn't room below.
 *  - Shifts LEFT to keep within the viewport's right edge.
 *  - Constrains height to fit within the viewport (with 16px margin) and
 *    scrolls internally if the content is taller.
 *  - Closes on Escape, scroll, resize, or click outside.
 */
function Popover({
  triggerRef,
  open,
  onClose,
  width,
  children,
}: {
  triggerRef: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Compute position whenever the popover opens; re-compute on resize/scroll.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 12;
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;

      // Available space below vs above the trigger
      const spaceBelow = viewportH - rect.bottom - margin;
      const spaceAbove = rect.top - margin;

      // Prefer below; flip above only if below is too small AND above has more room.
      const placeBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(200, Math.min(560, placeBelow ? spaceBelow : spaceAbove));

      const top = placeBelow ? rect.bottom + 6 : rect.top - maxHeight - 6;
      let left = rect.left;
      if (left + width > viewportW - margin) left = viewportW - width - margin;
      if (left < margin) left = margin;

      setPos({ top, left, maxHeight });
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true); // capture so nested scrolls fire too
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, triggerRef, width]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Render via portal so the popover escapes any overflow:hidden ancestor.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100]"
        onClick={onClose}
        // Don't block scroll while open — closing on scroll handles drift instead
      />
      <div
        ref={popoverRef}
        className="fixed z-[101] rounded-lg border bg-card shadow-2xl overflow-y-auto"
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width,
          maxHeight: pos?.maxHeight ?? 200,
        }}
        // Stop bubble so clicks inside don't trigger the click-outside catcher
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * Groups supplier sources by primary supplier name. The primary is the part
 * before the first " — " (em-dash w/ spaces). Sources without a dash are
 * their own group ("Hayden Agencies" stays as-is).
 *
 * Returns the groups map plus separate ordered arrays for linked-first /
 * unlinked-second rendering. Within each group, items keep their incoming
 * sort (cheapest-first, since the repo already orders that way).
 */
function groupSuppliers(list: SupplierSource[]): {
  byPrimary: Map<string, SupplierSource[]>;
  linkedOrder: string[];
  unlinkedOrder: string[];
} {
  const byPrimary = new Map<string, SupplierSource[]>();
  for (const s of list) {
    const idx = s.supplier_name.indexOf('—');
    const primary =
      idx === -1 ? s.supplier_name.trim() : s.supplier_name.slice(0, idx).trim();
    if (!byPrimary.has(primary)) byPrimary.set(primary, []);
    byPrimary.get(primary)!.push(s);
  }
  // Order groups: linked-only and mixed groups first (by their cheapest linked
  // source's price ascending), then groups whose every source is unlinked.
  const allNames = [...byPrimary.keys()];
  const linkedOrder = allNames.filter((n) => byPrimary.get(n)!.some((s) => s.url));
  const unlinkedOrder = allNames.filter((n) => byPrimary.get(n)!.every((s) => !s.url));
  return { byPrimary, linkedOrder, unlinkedOrder };
}

function SupplierGroup({
  groupName,
  sources,
  onPick,
}: {
  groupName: string;
  sources: SupplierSource[];
  onPick: (url: string | null | undefined) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="border-b last:border-b-0">
      <div className="px-3.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/20 flex items-center justify-between">
        <span>{groupName}</span>
        <span className="text-[10px] tabular-nums">
          {sources.length} option{sources.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul>
        {sources.map((s) => {
          const variant = supplierVariant(s.supplier_name);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.url)}
                className="w-full text-left px-3.5 py-2 text-sm hover:bg-accent/50 transition-colors flex items-center gap-3"
              >
                {s.photo_url ? (
                  <img
                    src={s.photo_url}
                    alt=""
                    className="h-11 w-11 rounded object-contain flex-shrink-0 border border-border bg-white p-0.5"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="h-11 w-11 rounded flex-shrink-0 border border-dashed border-border bg-muted/30" />
                )}
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium inline-flex items-center gap-1.5">
                    {variant ?? s.supplier_name}
                    {s.is_preferred === 1 && (
                      <span className="text-[10px] uppercase text-rose-700 font-medium">
                        preferred
                      </span>
                    )}
                  </span>
                  {s.notes && (
                    <span className="text-[11px] text-muted-foreground truncate">
                      {s.notes}
                    </span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap">
                  {s.unit_price_cents != null ? formatCents(s.unit_price_cents) : '—'}
                  <ExternalLink className="h-3 w-3" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UnlinkedSupplierRow({
  source,
  editing,
  draft,
  onStartEdit,
  onDraftChange,
  onCancel,
  onSave,
  saving,
}: {
  source: SupplierSource;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="px-3.5 py-2 text-sm flex items-start justify-between gap-2 border-b last:border-b-0">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="font-medium inline-flex items-center gap-1.5">
          {source.supplier_name}
          {source.is_preferred === 1 && (
            <span className="text-[10px] uppercase text-rose-700 font-medium">
              preferred
            </span>
          )}
        </span>
        {source.notes && (
          <span className="text-[11px] text-muted-foreground truncate">{source.notes}</span>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <Input
            autoFocus
            type="url"
            placeholder="https://..."
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') onCancel();
            }}
            className="h-7 text-xs w-44"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="text-xs text-rose-700 hover:underline whitespace-nowrap"
          >
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className="text-xs text-rose-700 hover:underline whitespace-nowrap flex-shrink-0"
        >
          + Add link
        </button>
      )}
    </div>
  );
}

/** Returns the variant part of a "Primary — Variant" supplier name, or null. */
function supplierVariant(name: string): string | null {
  const idx = name.indexOf('—');
  if (idx === -1) return null;
  return name.slice(idx + 1).trim() || null;
}

/**
 * Tab button styled with a bottom border accent on the active tab — used
 * for the Stock page category strip. Keeps things scannable when there are
 * 13+ categories: horizontal scroll on overflow rather than wrapping rows.
 */
function CategoryTab({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: 'warn';
}) {
  const baseColor =
    tone === 'warn'
      ? active
        ? 'text-orange-700 border-orange-500'
        : 'text-orange-700/70 hover:text-orange-700'
      : active
        ? 'text-foreground border-primary'
        : 'text-muted-foreground hover:text-foreground border-transparent';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${baseColor} ${
        active ? 'font-medium' : ''
      }`}
    >
      {label}
      <span
        className={`ml-1.5 text-[11px] tabular-nums ${
          active ? 'text-foreground/70' : 'text-muted-foreground/70'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.inventory.create.useMutation({
    onSuccess: () => {
      utils.inventory.list.invalidate();
      onClose();
    },
  });
  const prefs = usePrefs();

  // Pre-fill the unit + reorder threshold from saved Quality-of-life prefs so
  // Jade doesn't retype the same defaults on every new item.
  const [form, setForm] = useState({
    sku: '',
    name: '',
    category: '',
    unit: prefs.defaultUnit,
    on_hand: 0,
    reorder_at: prefs.defaultReorderAt,
    cost_cents: '' as string,
    notes: '',
    photo_url: '',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      unit: form.unit.trim() || 'each',
      on_hand: form.on_hand,
      reorder_at: form.reorder_at,
      cost_cents: form.cost_cents ? Math.round(parseFloat(form.cost_cents) * 100) : null,
      notes: form.notes.trim() || null,
      photo_url: form.photo_url.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New inventory item</DialogTitle>
          <DialogDescription>
            Adding starting stock writes an <em>opening_balance</em> movement automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="SKU" required>
            <Input
              required
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              placeholder="e.g. balloon-5in-blush"
            />
          </Field>
          <Field label="Category">
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="balloon-5in / ribbon / gift"
            />
          </Field>
          <Field label="Name" required className="col-span-2">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="5-inch blush balloon"
            />
          </Field>
          <Field label="Unit (each / pack / roll / metres / sheet / bag / bottle)">
            <Input
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              placeholder="each"
              list="unit-options"
            />
            <datalist id="unit-options">
              <option value="each" />
              <option value="pack" />
              <option value="roll" />
              <option value="metres" />
              <option value="sheet" />
              <option value="bag" />
              <option value="bottle" />
              <option value="box" />
              <option value="set" />
            </datalist>
          </Field>
          <Field label="Cost (AUD)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.cost_cents}
              onChange={(e) => setForm((f) => ({ ...f, cost_cents: e.target.value }))}
            />
          </Field>
          <Field label="Starting on-hand">
            <Input
              type="number"
              min="0"
              value={form.on_hand}
              onChange={(e) => setForm((f) => ({ ...f, on_hand: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label="Reorder at">
            <Input
              type="number"
              min="0"
              value={form.reorder_at}
              onChange={(e) =>
                setForm((f) => ({ ...f, reorder_at: Number(e.target.value) || 0 }))
              }
            />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Photo URL (optional)" className="col-span-2">
            <Input
              type="url"
              value={form.photo_url}
              onChange={(e) => setForm((f) => ({ ...f, photo_url: e.target.value }))}
              placeholder="https://supplier.com.au/.../swatch.png"
            />
          </Field>
          {create.error && (
            <p className="col-span-2 text-sm text-destructive">{create.error.message}</p>
          )}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isLoading}>
              {create.isLoading ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ mode, onClose }: { mode: AdjustMode; onClose: () => void }) {
  const utils = trpc.useUtils();
  const adjust = trpc.inventory.adjust.useMutation({
    onSuccess: () => {
      utils.inventory.list.invalidate();
      utils.inventory.movements.invalidate();
      onClose();
    },
  });
  const prefs = usePrefs();

  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  // Big-change confirmation. If the requested change is larger than the
  // user-configured threshold, force them to tick a box before saving —
  // catches accidental "1000" instead of "10" entries before they land
  // in the audit trail.
  const needsConfirm = qty > prefs.confirmAdjustAbove;
  const [confirmed, setConfirmed] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (needsConfirm && !confirmed) return; // form submit blocked, button is disabled too
    const signed = mode.signHint === 'subtract' ? -Math.abs(qty) : Math.abs(qty);
    adjust.mutate({
      inventory_item_id: mode.item.id,
      delta: signed,
      reason: mode.reason,
      note: note.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode.title}</DialogTitle>
          <DialogDescription>
            Current on hand: <strong className="tabular-nums">{mode.item.on_hand}</strong>{' '}
            {mode.item.unit}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label={mode.signHint === 'add' ? 'Amount to add' : 'Amount sold'}>
            <Input
              type="number"
              min="1"
              required
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Note (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                mode.reason === 'off_site_sale'
                  ? 'Customer / event / channel'
                  : 'Supplier / invoice ref'
              }
            />
          </Field>
          {needsConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
              <div className="font-medium text-amber-900">
                That's a big change ({qty} {mode.item.unit}).
              </div>
              <div className="text-foreground">
                Looks larger than your usual — set the threshold in <strong>Settings</strong> if
                you want a different cutoff.
              </div>
              <label className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span className="font-medium text-amber-900">Yes, that's right</span>
              </label>
            </div>
          )}
          {adjust.error && <p className="text-sm text-destructive">{adjust.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={adjust.isLoading || (needsConfirm && !confirmed)}
              title={needsConfirm && !confirmed ? 'Tick the confirmation above first' : ''}
            >
              {adjust.isLoading ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.inventory.update.useMutation({
    onSuccess: () => {
      utils.inventory.list.invalidate();
      onClose();
    },
  });
  const movements = trpc.inventory.movements.useQuery({
    inventory_item_id: item.id,
    limit: 20,
  });

  const [form, setForm] = useState({
    sku: item.sku,
    name: item.name,
    category: item.category ?? '',
    unit: item.unit,
    reorder_at: item.reorder_at,
    cost_cents: item.cost_cents == null ? '' : (item.cost_cents / 100).toFixed(2),
    notes: item.notes ?? '',
    photo_url: item.photo_url ?? '',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({
      id: item.id,
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      unit: form.unit.trim() || 'each',
      reorder_at: form.reorder_at,
      cost_cents: form.cost_cents ? Math.round(parseFloat(form.cost_cents) * 100) : null,
      notes: form.notes.trim() || null,
      photo_url: form.photo_url.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit — {item.name}</DialogTitle>
          <DialogDescription>
            Change item details. Use Add/Sale to change on-hand counts so movements are recorded.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <Input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
          </Field>
          <Field label="Category">
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </Field>
          <Field label="Name" className="col-span-2">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Unit (each / pack / roll / metres / sheet / bag / bottle)">
            <Input
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              list="unit-options"
            />
          </Field>
          <Field label="Cost (AUD)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.cost_cents}
              onChange={(e) => setForm((f) => ({ ...f, cost_cents: e.target.value }))}
            />
          </Field>
          <Field label="Reorder at" className="col-span-2">
            <Input
              type="number"
              min="0"
              value={form.reorder_at}
              onChange={(e) =>
                setForm((f) => ({ ...f, reorder_at: Number(e.target.value) || 0 }))
              }
            />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <Field label="Photo URL (optional)" className="col-span-2">
            <div className="flex items-center gap-3">
              {form.photo_url && (
                <img
                  src={form.photo_url}
                  alt=""
                  className="h-10 w-10 rounded object-cover border border-border bg-muted flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.opacity = '0.3';
                  }}
                />
              )}
              <Input
                type="url"
                placeholder="https://supplier.com.au/.../swatch.png"
                value={form.photo_url}
                onChange={(e) => setForm((f) => ({ ...f, photo_url: e.target.value }))}
              />
            </div>
          </Field>
          {update.error && (
            <p className="col-span-2 text-sm text-destructive">{update.error.message}</p>
          )}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isLoading}>
              {update.isLoading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>

        <SupplierSourcesSection itemId={item.id} />

        <section className="mt-2">
          <h3 className="text-sm font-medium mb-2">Recent movements</h3>
          <div className="rounded-md border max-h-56 overflow-auto">
            {movements.data && movements.data.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">No movements yet.</p>
            )}
            <ul className="divide-y text-xs">
              {movements.data?.map((m: StockMovement) => (
                <li key={m.id} className="px-3 py-2 flex justify-between gap-3">
                  <span className="text-muted-foreground">{formatDate(m.created_at)}</span>
                  <span className="capitalize">{m.reason.replace(/_/g, ' ')}</span>
                  <span className={`tabular-nums ${m.delta < 0 ? 'text-destructive' : 'text-green-700'}`}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                  <span className="text-muted-foreground truncate max-w-[40%]">{m.note ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reorder-sources editor inside the Edit dialog. Lists existing supplier
 * sources for an inventory item, lets Jade add / edit / delete, and toggle
 * which one is preferred. Prices are stored as cents — the UI shows + accepts
 * decimal AUD.
 */
function SupplierSourcesSection({ itemId }: { itemId: number }) {
  const utils = trpc.useUtils();
  const sources = trpc.suppliers.forItem.useQuery({ inventory_item_id: itemId });
  const create = trpc.suppliers.create.useMutation({
    onSuccess: () => utils.suppliers.forItem.invalidate({ inventory_item_id: itemId }),
  });
  const updateMut = trpc.suppliers.update.useMutation({
    onSuccess: () => utils.suppliers.forItem.invalidate({ inventory_item_id: itemId }),
  });
  const del = trpc.suppliers.delete.useMutation({
    onSuccess: () => utils.suppliers.forItem.invalidate({ inventory_item_id: itemId }),
  });

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ supplier_name: '', url: '', price: '', notes: '', preferred: false });

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      inventory_item_id: itemId,
      supplier_name: draft.supplier_name.trim(),
      url: draft.url.trim() || null,
      unit_price_cents: draft.price ? Math.round(parseFloat(draft.price) * 100) : null,
      is_preferred: draft.preferred,
      notes: draft.notes.trim() || null,
    });
    setDraft({ supplier_name: '', url: '', price: '', notes: '', preferred: false });
    setAdding(false);
  }

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Reorder sources</h3>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" /> Add supplier
          </Button>
        )}
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        {sources.data && sources.data.length === 0 && !adding && (
          <p className="px-3 py-4 text-sm text-muted-foreground text-center">
            No suppliers yet. Add one and the Reorder button will appear on the Stock page.
          </p>
        )}
        {sources.data && sources.data.length > 0 && (
          <SupplierGroupedList
            sources={sources.data}
            onUpdate={(id, patch) => updateMut.mutate({ id, ...patch })}
            onDelete={(s) => {
              if (window.confirm(`Remove supplier "${s.supplier_name}"?`)) {
                del.mutate({ id: s.id });
              }
            }}
            busy={updateMut.isLoading || del.isLoading}
          />
        )}

        {adding && (
          <form onSubmit={submitNew} className="border-t bg-muted/20 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Supplier name"
                value={draft.supplier_name}
                onChange={(e) => setDraft((d) => ({ ...d, supplier_name: e.target.value }))}
                required
              />
              <Input
                type="url"
                placeholder="https://supplier.com.au/specific-product (optional)"
                value={draft.url}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Last paid price (AUD, optional)"
                value={draft.price}
                onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
              />
              <Input
                placeholder="Notes (e.g. login, min order)"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={draft.preferred}
                  onChange={(e) => setDraft((d) => ({ ...d, preferred: e.target.checked }))}
                />
                Mark as preferred
              </label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={create.isLoading}>
                  {create.isLoading ? 'Saving…' : 'Add'}
                </Button>
              </div>
            </div>
            {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
          </form>
        )}
      </div>
    </section>
  );
}

/**
 * Renders supplier sources grouped by primary supplier (e.g. "OPS").
 * Groups with many sources start collapsed so the editor stays scannable
 * for items like foil letters that have 13 colour variants.
 */
function SupplierGroupedList({
  sources,
  onUpdate,
  onDelete,
  busy,
}: {
  sources: SupplierSource[];
  onUpdate: (id: number, patch: Parameters<typeof onDeleteFn>[0]) => void;
  onDelete: (source: SupplierSource) => void;
  busy: boolean;
}) {
  const groups = groupSuppliers(sources);
  const allOrder = [...groups.linkedOrder, ...groups.unlinkedOrder];

  // Default-collapse any group with 4+ sources
  const initiallyCollapsed = new Set(
    allOrder.filter((g) => groups.byPrimary.get(g)!.length >= 4),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(initiallyCollapsed);

  function toggle(group: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div>
      {allOrder.map((group) => {
        const groupSources = groups.byPrimary.get(group)!;
        const isCollapsed = collapsed.has(group);
        return (
          <div key={group} className="border-b last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(group)}
              className="w-full px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground bg-muted/20 hover:bg-muted/40 transition-colors flex items-center justify-between"
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[10px]">{isCollapsed ? '▸' : '▾'}</span>
                {group}
                <span className="text-[10px] tabular-nums normal-case text-muted-foreground/70 ml-1">
                  {groupSources.length} {groupSources.length === 1 ? 'option' : 'options'}
                </span>
              </span>
            </button>
            {!isCollapsed && (
              <ul className="divide-y">
                {groupSources.map((s) => (
                  <SupplierRow
                    key={s.id}
                    source={s}
                    onUpdate={(patch) => onUpdate(s.id, patch)}
                    onDelete={() => onDelete(s)}
                    busy={busy}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
// Phantom helper used only for the type of `onUpdate` patch shape above —
// keeps the call site readable without a sprawling generic.
declare const onDeleteFn: SupplierRowProps['onUpdate'];

type SupplierRowProps = Parameters<typeof SupplierRow>[0];

function SupplierRow({
  source,
  onUpdate,
  onDelete,
  busy,
}: {
  source: SupplierSource;
  onUpdate: (patch: { supplier_name?: string; url?: string | null; unit_price_cents?: number | null; is_preferred?: boolean; notes?: string | null }) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    supplier_name: source.supplier_name,
    // Coerce a null URL to an empty string so the controlled <Input> stays
    // happy. save() turns empty back into null on the way out.
    url: source.url ?? '',
    price: source.unit_price_cents == null ? '' : (source.unit_price_cents / 100).toFixed(2),
    notes: source.notes ?? '',
  });

  if (!editing) {
    return (
      <li className="px-3 py-2 flex items-start justify-between gap-3 hover:bg-accent/30">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium inline-flex items-center gap-1.5">
            {source.supplier_name}
            {source.is_preferred === 1 && (
              <span className="text-[10px] uppercase text-rose-700">preferred</span>
            )}
            {!source.url && (
              <span className="text-[10px] uppercase text-muted-foreground">not linked</span>
            )}
          </div>
          {source.url ? (
            <div className="text-[11px] text-muted-foreground truncate">{source.url}</div>
          ) : (
            <div className="text-[11px] text-muted-foreground italic">No product URL yet — click the pencil to add one.</div>
          )}
          {source.notes && (
            <div className="text-[11px] text-muted-foreground italic mt-0.5">{source.notes}</div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">
            {source.unit_price_cents != null ? formatCents(source.unit_price_cents) : '—'}
          </span>
          {source.is_preferred === 0 && (
            <Button
              size="sm"
              variant="ghost"
              title="Mark preferred"
              onClick={() => onUpdate({ is_preferred: true })}
              disabled={busy}
            >
              ★
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
            ×
          </Button>
        </div>
      </li>
    );
  }

  function save() {
    onUpdate({
      supplier_name: draft.supplier_name.trim(),
      url: draft.url.trim() || null,
      unit_price_cents: draft.price ? Math.round(parseFloat(draft.price) * 100) : null,
      notes: draft.notes.trim() || null,
    });
    setEditing(false);
  }

  return (
    <li className="px-3 py-2 bg-muted/20 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="Supplier name"
          value={draft.supplier_name}
          onChange={(e) => setDraft((d) => ({ ...d, supplier_name: e.target.value }))}
        />
        <Input
          type="url"
          placeholder="https://..."
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
        />
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="Last paid price (AUD)"
          value={draft.price}
          onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
        />
        <Input
          placeholder="Notes"
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
        />
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </li>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
