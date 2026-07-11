import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle2, BadgeCheck, Trash2, Zap } from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { useToast } from '../lib/toast';
import { formatCents, formatDate } from '../lib/format';
import type {
  CatalogueEntryWithCounts,
  Order,
  RecipePreviewLine,
} from '@shared/types';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const id = Number(params.id);

  const order = trpc.orders.byId.useQuery({ id }, { enabled: id > 0 });
  const preview = trpc.orders.recipePreview.useQuery({ id }, { enabled: id > 0 });
  const catalogue = trpc.catalogue.list.useQuery({});

  // Two-step confirm before stock deduction — declared up front so the
  // confirm.mutation onSuccess handler below can close the dialog cleanly.
  const [confirmingApply, setConfirmingApply] = useState(false);

  const utils = trpc.useUtils();
  const updateCustom = trpc.orders.updateCustomisation.useMutation({
    onSuccess: () => {
      utils.orders.byId.invalidate({ id });
      utils.orders.recipePreview.invalidate({ id });
      utils.orders.list.invalidate();
    },
  });
  const confirm = trpc.orders.confirm.useMutation({
    onSuccess: async () => {
      setConfirmingApply(false);
      await Promise.all([
        utils.orders.byId.invalidate({ id }),
        utils.orders.recipePreview.invalidate({ id }),
        utils.orders.list.invalidate(),
        utils.inventory.list.invalidate(),
        utils.dashboard.summary.invalidate(),
      ]);
      const summary = await utils.dashboard.summary.fetch();
      toast({
        title: 'Stock deducted',
        description: 'Order confirmed and movements written.',
        variant: 'success',
      });
      if (summary.low_stock.length > 0) {
        toast({
          title: `Low stock: ${summary.low_stock.length} item${
            summary.low_stock.length > 1 ? 's' : ''
          }`,
          description: summary.low_stock
            .slice(0, 3)
            .map((i) => `${i.name} (${i.on_hand}/${i.reorder_at})`)
            .join(', '),
          variant: 'warning',
        });
      }
    },
    onError: (err) => toast({ title: 'Confirm failed', description: err.message, variant: 'error' }),
  });
  const confirmWithoutStock = trpc.orders.confirmWithoutStock.useMutation({
    onSuccess: () => {
      utils.orders.byId.invalidate({ id });
      utils.orders.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast({
        title: 'Order confirmed',
        description: 'No stock was deducted. Apply it later after stocktake.',
        variant: 'success',
      });
    },
    onError: (err) => toast({ title: 'Confirm failed', description: err.message, variant: 'error' }),
  });
  const reverse = trpc.orders.reverseStock.useMutation({
    onSuccess: () => {
      utils.orders.byId.invalidate({ id });
      utils.orders.recipePreview.invalidate({ id });
      utils.orders.list.invalidate();
      utils.inventory.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast({ title: 'Stock restored', variant: 'success' });
    },
  });
  const markPaid = trpc.orders.markPaid.useMutation({
    onSuccess: () => {
      utils.orders.byId.invalidate({ id });
      utils.orders.list.invalidate();
    },
  });
  const unmarkPaid = trpc.orders.unmarkPaid.useMutation({
    onSuccess: () => {
      utils.orders.byId.invalidate({ id });
      utils.orders.list.invalidate();
    },
  });
  const setStatus = trpc.orders.setStatus.useMutation({
    onSuccess: () => {
      utils.orders.byId.invalidate({ id });
      utils.orders.list.invalidate();
    },
  });
  const deleteOrder = trpc.orders.delete.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.inventory.list.invalidate();
      navigate('/orders');
    },
  });

  if (!id) return null;

  return (
    <div className="p-8 space-y-5 max-w-4xl">
      <button
        onClick={() => navigate('/orders')}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back to orders
      </button>

      {order.data && (
        <>
          <OrderHeader
            order={order.data}
            onConfirm={() => setConfirmingApply(true)}
            confirmDisabled={
              confirm.isLoading ||
              order.data.stock_applied === 1 ||
              !order.data.paid_at ||
              !!preview.data?.unresolvedRecipes.length
            }
            confirmLoading={confirm.isLoading}
            onConfirmWithoutStock={() => confirmWithoutStock.mutate({ id })}
            confirmWithoutStockLoading={confirmWithoutStock.isLoading}
            onReverse={() => reverse.mutate({ id })}
            reverseLoading={reverse.isLoading}
            onMarkPaid={() => markPaid.mutate({ id })}
            markPaidLoading={markPaid.isLoading}
            onUnmarkPaid={() => unmarkPaid.mutate({ id })}
            onSetStatus={(s) => setStatus.mutate({ id, app_status: s })}
            onDelete={() => deleteOrder.mutate({ id })}
            deleteLoading={deleteOrder.isLoading}
          />

          <SourceBanner order={order.data} />

          <div className="grid md:grid-cols-2 gap-4">
            <CustomerCard order={order.data} />
            <CustomisationCard
              order={order.data}
              catalogueEntries={catalogue.data ?? []}
              saving={updateCustom.isLoading}
              onSave={(patch) => updateCustom.mutate({ id, ...patch })}
            />
          </div>

          {order.data.notes && (
            <section className="brand-surface p-4 text-sm">
              <h3 className="brand-label mb-1">
                Customer notes
              </h3>
              <p className="whitespace-pre-wrap">{order.data.notes}</p>
            </section>
          )}

          <RecipePreview
            preview={preview.data}
            stockApplied={order.data.stock_applied === 1}
          />

          <ConfirmStockDeductionDialog
            open={confirmingApply}
            onOpenChange={setConfirmingApply}
            order={order.data}
            preview={preview.data}
            onConfirm={() => confirm.mutate({ id })}
            confirming={confirm.isLoading}
          />
        </>
      )}
    </div>
  );
}

/**
 * Two-step confirmation before applying stock. Shows the exact list of
 * items + quantities about to be deducted, the customer + recipient, and
 * the order total. Cancel just closes; Confirm fires the mutation.
 *
 * Why this exists: clicking the header's "Confirm & deduct stock" used to
 * fire the mutation immediately. Misclicks (or hover-to-click on a
 * trackpad) caused unwanted deductions which had to be cleaned up via
 * Reverse Stock. The dialog turns it into a deliberate two-step.
 */
function ConfirmStockDeductionDialog({
  open,
  onOpenChange,
  order,
  preview,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  order: Order;
  preview: { lines: RecipePreviewLine[]; unresolvedRecipes: Array<{ kind: string; external_id: string; reason: string }> } | undefined;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const lines = preview?.lines ?? [];
  const unresolved = preview?.unresolvedRecipes ?? [];
  const willGoNegative = lines.filter((l) => l.current_on_hand - l.quantity < 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Confirm stock deduction</DialogTitle>
          <DialogDescription>
            Apply this order's recipe to inventory. This writes stock movements
            and updates on-hand counts. You can reverse it later if needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="brand-surface-inset px-3 py-2">
            <div className="font-medium">
              {order.customer_name ?? 'Unknown'}
              {order.recipient && (
                <span className="text-muted-foreground"> → {order.recipient}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCents(order.total_cents)}
              {order.bundle_name && ` · Bundle: ${order.bundle_name}`}
              {order.occasion && ` · ${order.occasion}`}
            </div>
          </div>

          {unresolved.length > 0 && (
            <div className="brand-alert-warn px-3 py-2 text-xs">
              <div className="font-medium brand-alert-warn-strong mb-1">
                {unresolved.length} unresolved recipe{unresolved.length === 1 ? '' : 's'} — partial deduction
              </div>
              <ul className="opacity-80 space-y-0.5 pl-4 list-disc">
                {unresolved.slice(0, 5).map((u, i) => (
                  <li key={i}>
                    {u.kind} '{u.external_id}': {u.reason}
                  </li>
                ))}
                {unresolved.length > 5 && <li>+{unresolved.length - 5} more…</li>}
              </ul>
            </div>
          )}

          <div className="brand-surface-inset overflow-hidden">
            <div className="px-3 py-2 brand-label border-b border-border">
              About to deduct ({lines.length} item{lines.length === 1 ? '' : 's'})
            </div>
            {lines.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted-foreground text-xs">
                No deductions — every recipe component is unresolved or this order has no recipes wired.
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-72 overflow-auto">
                {lines.map((line) => {
                  const after = line.current_on_hand - line.quantity;
                  const goesNegative = after < 0;
                  return (
                    <li key={line.inventory_item_id} className="px-3 py-2 flex items-baseline gap-3 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{line.inventory_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate">{line.inventory_sku}</div>
                      </div>
                      <div className="tabular-nums text-right whitespace-nowrap">
                        <span className="text-muted-foreground">{line.current_on_hand}</span>
                        <span className="mx-1 text-muted-foreground">−</span>
                        <span className="font-medium">{line.quantity}</span>
                        <span className="mx-1 text-muted-foreground">=</span>
                        <span className={goesNegative ? 'text-destructive font-medium' : ''}>{after}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {willGoNegative.length > 0 && (
            <div className="brand-alert-warn px-3 py-2 text-xs">
              <div className="font-medium brand-alert-warn-strong">
                {willGoNegative.length} item{willGoNegative.length === 1 ? '' : 's'} will go negative
              </div>
              <div className="opacity-80 mt-0.5">
                You can still confirm — Jade may have stock that's not been counted yet.
                Reorder these or do a stocktake afterward.
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Applying…' : `Yes, deduct stock (${lines.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceBanner({ order }: { order: Order }) {
  const sources: string[] = [];
  if (order.stripe_session_id) sources.push('Stripe');
  if (order.netlify_submission_id) sources.push('Netlify Forms');
  if (order.graph_message_id) sources.push('Outlook email');
  const isFailsafe =
    !order.stripe_session_id && order.source === 'netlify' && !order.manually_marked_paid;
  const isManual = order.source === 'manual';
  const isRefunded = order.app_status === 'refunded';
  const refundNeedsReversal = isRefunded && order.stock_applied === 1;

  return (
    <section
      className={`p-3 text-sm ${
        refundNeedsReversal
          ? 'brand-alert-danger'
          : isRefunded
            ? 'brand-alert-honey'
            : isFailsafe
              ? 'brand-alert-honey'
              : isManual
                ? 'brand-alert-info'
                : 'brand-alert-info'
      }`}
    >
      {refundNeedsReversal ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" /> Refunded — stock still deducted
          </div>
          <p className="text-xs">
            Stripe reported a refund for this order, but the recipe stock was already applied.
            Click <strong>Reverse stock</strong> below to restore on-hand counts.
          </p>
        </div>
      ) : isRefunded ? (
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Refunded in Stripe. Stock not applied — nothing to
          reverse.
        </div>
      ) : isFailsafe ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" /> Failsafe order — Netlify confirmed, Stripe didn't
          </div>
          <p className="text-xs">
            The customer submitted the form but Stripe hasn't reported this session as paid. Check
            your Stripe dashboard or bank statement to confirm the payment. If it really did go
            through, click <strong>Mark paid</strong> below.
          </p>
        </div>
      ) : isManual ? (
        <div className="flex items-center gap-1.5">
          <BadgeCheck className="h-4 w-4" /> Manual order entered in this app.
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Sources: {sources.length ? sources.join(' + ') : 'none'} · Match:{' '}
          <span className="font-mono">{order.match_status}</span>
        </div>
      )}
    </section>
  );
}

// Brand-toned status pill mapping — mirrors Orders.tsx so the header
// capsule here matches the pill on the orders list.
const appPill: Record<Order['app_status'], string> = {
  new: 'brand-pill-new',
  confirmed: 'brand-pill-confirmed',
  fulfilled: 'brand-pill-fulfilled',
  cancelled: 'brand-pill-cancelled',
  refunded: 'brand-pill-refunded',
};

function OrderHeader({
  order,
  onConfirm,
  confirmDisabled,
  confirmLoading,
  onConfirmWithoutStock,
  confirmWithoutStockLoading,
  onReverse,
  reverseLoading,
  onMarkPaid,
  markPaidLoading,
  onUnmarkPaid,
  onSetStatus,
  onDelete,
  deleteLoading,
}: {
  order: Order;
  onConfirm: () => void;
  confirmDisabled: boolean;
  confirmLoading: boolean;
  onConfirmWithoutStock: () => void;
  confirmWithoutStockLoading: boolean;
  onReverse: () => void;
  reverseLoading: boolean;
  onMarkPaid: () => void;
  markPaidLoading: boolean;
  onUnmarkPaid: () => void;
  onSetStatus: (s: Order['app_status']) => void;
  onDelete: () => void;
  deleteLoading: boolean;
}) {
  const paid = !!order.paid_at;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {paid ? `Paid ${formatDate(order.paid_at)}` : 'Not yet paid'}
            {order.manually_marked_paid === 1 && (
              <span className="ml-2 text-warning-deep">
                · manually marked paid {formatDate(order.manual_paid_at)}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-serif-brand font-medium leading-tight">{formatCents(order.total_cents)} order</h1>
          <div className="text-xs text-muted-foreground tabular-nums">
            includes {formatCents(Math.round(order.total_cents / 11))} GST
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-0.5">
            {order.stripe_session_id ?? <em>no Stripe session</em>}
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <span className={`brand-pill capitalize ${appPill[order.app_status]}`}>
            {order.app_status}
          </span>
          {order.rush_order === 'yes' && (
            <span
              className="brand-pill brand-pill-honey"
              title="Rush order — 24–48 hr turnaround"
            >
              <Zap className="h-3 w-3" /> Rush +${order.rush_fee ?? '25.00'}
            </span>
          )}
          {order.stock_applied === 1 && (
            <span className="brand-pill brand-pill-confirmed">
              <CheckCircle2 className="h-3 w-3" /> Stock applied
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!paid && (
          <Button onClick={onMarkPaid} disabled={markPaidLoading} variant="default">
            {markPaidLoading ? 'Marking…' : 'Mark paid (verified externally)'}
          </Button>
        )}
        {paid && order.stock_applied === 0 && (order.app_status === 'new' || order.app_status === 'confirmed') && (
          <Button onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLoading ? 'Applying stock…' : 'Confirm & deduct stock'}
          </Button>
        )}
        {paid && order.app_status === 'new' && (
          <Button
            onClick={onConfirmWithoutStock}
            disabled={confirmWithoutStockLoading}
            variant="outline"
            title="Keeps the order moving without changing inventory during stocktake"
          >
            {confirmWithoutStockLoading ? 'Confirming...' : 'Confirm without stocktake'}
          </Button>
        )}
        {order.app_status === 'confirmed' && (
          <Button onClick={() => onSetStatus('fulfilled')} variant="secondary">
            Mark fulfilled
          </Button>
        )}
        {order.stock_applied === 1 && (
          <Button onClick={onReverse} variant="outline" disabled={reverseLoading}>
            {reverseLoading ? 'Reversing…' : 'Reverse stock'}
          </Button>
        )}
        {order.manually_marked_paid === 1 && order.stock_applied === 0 && (
          <Button onClick={onUnmarkPaid} variant="ghost">
            Undo mark paid
          </Button>
        )}
        {order.app_status !== 'cancelled' && order.app_status !== 'refunded' && (
          <Button onClick={() => onSetStatus('cancelled')} variant="ghost">
            Cancel order
          </Button>
        )}
        <span className="ml-auto" />
        {confirmingDelete ? (
          <>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={deleteLoading}
              title={
                order.stock_applied === 1
                  ? 'Will restore on-hand counts before deleting'
                  : undefined
              }
            >
              <Trash2 className="h-4 w-4" />
              {deleteLoading ? 'Deleting…' : 'Yes, delete permanently'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="h-4 w-4 text-destructive" /> Delete
          </Button>
        )}
      </div>
    </header>
  );
}

function CustomerCard({ order }: { order: Order }) {
  // Pretty zone label so the order detail reads like a human wrote it.
  const zoneLabel = (() => {
    switch (order.delivery_zone) {
      case 'bathurst':
        return 'Bathurst';
      case 'nearby':
        return 'Lithgow / Orange / Blayney / Oberon';
      case 'elsewhere':
        return order.delivery_suburb
          ? `${order.delivery_suburb} (quoted)`
          : 'Somewhere else (quote pending)';
      case 'pickup':
        return 'Pickup from Bathurst';
      default:
        return null;
    }
  })();

  // Bundle origin readout. Bundle orders carry flow_type='bundle' + bundle_id
  // + bundle_name + a comma-separated list of locked addons (the gift contents
  // the customer didn't pick — Jade did). Surface them so Jade sees at a
  // glance "this came from a bundle, here's what's locked in" without having
  // to cross-reference the addons list against the bundle catalogue.
  const lockedAddons = order.locked_addons_csv
    ? order.locked_addons_csv.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <section className="brand-surface p-4 space-y-2 text-sm">
      <h3 className="brand-label">
        Customer
      </h3>
      <Row label="Name" value={order.customer_name} />
      <Row label="Email" value={order.customer_email} mono />
      <Row label="Phone" value={order.customer_phone} mono />
      {order.flow_type === 'bundle' && (
        <>
          <hr className="my-2" />
          <Row label="Bundle" value={order.bundle_name ?? order.bundle_id} />
          {lockedAddons.length > 0 && (
            <Row
              label="Bundle contents"
              value={lockedAddons.join(' · ')}
            />
          )}
        </>
      )}
      <hr className="my-2" />
      <Row label="Recipient" value={order.recipient} />
      <Row label="Occasion" value={order.occasion} />
      <Row
        label="Date needed"
        value={
          order.date_needed
            ? order.time_needed
              ? `${order.date_needed} · ${order.time_needed}`
              : order.date_needed
            : null
        }
      />
      <Row label="Fulfilment" value={order.fulfilment} />
      {zoneLabel && <Row label="Delivery zone" value={zoneLabel} />}
      {order.delivery_suburb && order.delivery_zone === 'elsewhere' && (
        <Row label="Suburb" value={order.delivery_suburb} />
      )}
      {order.address && <Row label="Address" value={order.address} />}
    </section>
  );
}

function CustomisationCard({
  order,
  catalogueEntries,
  saving,
  onSave,
}: {
  order: Order;
  catalogueEntries: CatalogueEntryWithCounts[];
  saving: boolean;
  onSave: (patch: {
    finish_id?: string | null;
    palette_id?: string | null;
    design_slug?: string | null;
    addon_ids?: string[] | null;
  }) => void;
}) {
  const finishes = useMemo(
    () => catalogueEntries.filter((e) => e.kind === 'finish'),
    [catalogueEntries],
  );
  const palettes = useMemo(
    () => catalogueEntries.filter((e) => e.kind === 'palette'),
    [catalogueEntries],
  );
  const designs = useMemo(
    () => catalogueEntries.filter((e) => e.kind === 'design'),
    [catalogueEntries],
  );
  const addons = useMemo(
    () => catalogueEntries.filter((e) => e.kind === 'addon'),
    [catalogueEntries],
  );

  const orderAddonIds = useMemo<string[]>(() => {
    if (!order.addon_ids_json) return [];
    try {
      return JSON.parse(order.addon_ids_json) as string[];
    } catch {
      return [];
    }
  }, [order.addon_ids_json]);

  return (
    <section className="brand-surface p-4 space-y-3 text-sm">
      <h3 className="brand-label">
        Customisation
        {saving && <span className="ml-2 text-muted-foreground">saving…</span>}
      </h3>

      <SelectField
        label="Design"
        value={order.design_slug ?? ''}
        options={designs.map((d) => ({ value: d.external_id, label: d.name }))}
        onChange={(v) => onSave({ design_slug: v || null })}
      />
      <SelectField
        label="Finish"
        value={order.finish_id ?? ''}
        options={finishes.map((f) => ({ value: f.external_id, label: f.name }))}
        onChange={(v) => onSave({ finish_id: v || null })}
      />
      <SelectField
        label="Palette"
        value={order.palette_id ?? ''}
        options={palettes.map((p) => ({ value: p.external_id, label: p.name }))}
        onChange={(v) => onSave({ palette_id: v || null })}
      />
      {order.palette_id === 'custom' && order.custom_palette && (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm">
          <div className="brand-label mb-1">
            Custom palette description
          </div>
          <p className="text-foreground italic">&ldquo;{order.custom_palette}&rdquo;</p>
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Add-ons</div>
        <div className="flex flex-wrap gap-1.5">
          {addons.map((a) => {
            const on = orderAddonIds.includes(a.external_id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  const next = on
                    ? orderAddonIds.filter((x) => x !== a.external_id)
                    : [...orderAddonIds, a.external_id];
                  onSave({ addon_ids: next });
                }}
                className={`text-xs px-2 py-1 rounded-full border ${
                  on
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {a.name}
              </button>
            );
          })}
          {addons.length === 0 && (
            <span className="text-xs text-muted-foreground">No add-ons in catalogue.</span>
          )}
        </div>
      </div>
    </section>
  );
}

function RecipePreview({
  preview,
  stockApplied,
}: {
  preview:
    | {
        lines: RecipePreviewLine[];
        unresolvedRecipes: Array<{ kind: string; external_id: string; reason: string }>;
      }
    | undefined;
  stockApplied: boolean;
}) {
  if (!preview) return null;

  return (
    <section className="brand-surface overflow-hidden">
      <header className="px-4 py-3 border-b">
        <h3 className="text-sm font-medium">
          {stockApplied ? 'Applied stock movements' : 'Stock that will be deducted on confirm'}
        </h3>
        <p className="text-xs text-muted-foreground">
          Composed from the order's design + finish + palette + each add-on. Quantities aggregate
          when multiple recipes hit the same SKU.
        </p>
      </header>

      {preview.unresolvedRecipes.length > 0 && (
        <div className="px-4 py-3 brand-alert-warn space-y-1 text-sm rounded-none">
          <div className="flex items-center gap-1.5 font-medium brand-alert-warn-strong">
            <AlertTriangle className="h-4 w-4" /> Some recipes can't be resolved
          </div>
          <ul className="text-xs opacity-80 space-y-0.5 pl-5 list-disc">
            {preview.unresolvedRecipes.map((u, i) => (
              <li key={i}>
                <strong>{u.kind}</strong> '{u.external_id}': {u.reason}
              </li>
            ))}
          </ul>
          <p className="text-xs text-warning-deep opacity-80">
            Fix this in the Products page (or change the customisation above) before confirming.
          </p>
        </div>
      )}

      {preview.lines.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No deductions yet — pick a finish/palette/add-on above (or fill in their recipes in the
          Products page).
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2">Inventory item</th>
              <th className="text-left font-medium px-4 py-2">From</th>
              <th className="text-right font-medium px-4 py-2">Qty</th>
              <th className="text-right font-medium px-4 py-2">On hand → after</th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((l) => {
              const after = l.current_on_hand - Math.round(l.quantity);
              const negative = after < 0;
              return (
                <tr key={l.inventory_item_id} className="border-t">
                  <td className="px-4 py-2">
                    <div>{l.inventory_name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{l.inventory_sku}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground capitalize">
                    {l.source_kind}: {l.source_name}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.quantity}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      negative ? 'text-destructive font-medium' : ''
                    }`}
                  >
                    {l.current_on_hand} → {after}
                    {negative && (
                      <AlertTriangle className="h-3.5 w-3.5 inline ml-1 align-text-bottom" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>
        {value || <em className="text-muted-foreground font-sans">—</em>}
      </span>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">— None —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.value})
          </option>
        ))}
      </select>
    </label>
  );
}
