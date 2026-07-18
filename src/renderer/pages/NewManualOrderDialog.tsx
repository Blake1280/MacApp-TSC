import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function NewManualOrderDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const catalogue = trpc.catalogue.list.useQuery({});
  const create = trpc.orders.createManual.useMutation({
    onSuccess: (order) => {
      utils.orders.list.invalidate();
      onClose();
      navigate(`/orders/${order.id}`);
    },
  });

  const designs = useMemo(
    () => (catalogue.data ?? []).filter((e) => e.kind === 'design'),
    [catalogue.data],
  );
  const finishes = useMemo(
    () => (catalogue.data ?? []).filter((e) => e.kind === 'finish'),
    [catalogue.data],
  );
  const palettes = useMemo(
    () => (catalogue.data ?? []).filter((e) => e.kind === 'palette'),
    [catalogue.data],
  );
  const addons = useMemo(
    () => (catalogue.data ?? []).filter((e) => e.kind === 'addon'),
    [catalogue.data],
  );

  const [form, setForm] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    recipient: '',
    occasion: '',
    date_needed: '',
    fulfilment: '',
    notes: '',
    total: '',
    design_slug: '',
    finish_id: '',
    palette_id: '',
    addon_ids: [] as string[],
    mark_paid: true,
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleAddon(id: string) {
    update(
      'addon_ids',
      form.addon_ids.includes(id)
        ? form.addon_ids.filter((x) => x !== id)
        : [...form.addon_ids, id],
    );
  }

  function selectDesign(value: string) {
    const design = designs.find((entry) => entry.external_id === value);
    setForm((current) => ({
      ...current,
      design_slug: value,
      finish_id: design?.default_finish_id ?? current.finish_id,
      palette_id: design?.default_palette_id ?? current.palette_id,
      total: design?.price_cents != null
        ? (design.price_cents / 100).toFixed(2)
        : current.total,
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      customer_name: form.customer_name.trim() || null,
      customer_email: form.customer_email.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      recipient: form.recipient.trim() || null,
      occasion: form.occasion.trim() || null,
      date_needed: form.date_needed.trim() || null,
      fulfilment: form.fulfilment.trim() || null,
      notes: form.notes.trim() || null,
      total_cents: form.total ? Math.round(parseFloat(form.total) * 100) : 0,
      design_slug: form.design_slug || null,
      finish_id: form.finish_id || null,
      palette_id: form.palette_id || null,
      addon_ids: form.addon_ids,
      mark_paid: form.mark_paid,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New manual order</DialogTitle>
          <DialogDescription>
            For phone orders, in-person sales, or orders Stripe missed. Pick the design / finish /
            palette / add-ons so stock deducts correctly when you confirm.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Customer
            </legend>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Customer name">
                <Input
                  value={form.customer_name}
                  onChange={(e) => update('customer_name', e.target.value)}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => update('customer_email', e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.customer_phone}
                  onChange={(e) => update('customer_phone', e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Recipient">
                <Input
                  value={form.recipient}
                  onChange={(e) => update('recipient', e.target.value)}
                />
              </Field>
              <Field label="Occasion">
                <Input
                  value={form.occasion}
                  onChange={(e) => update('occasion', e.target.value)}
                  placeholder="Birthday, Anniversary…"
                />
              </Field>
              <Field label="Date needed">
                <Input
                  type="date"
                  value={form.date_needed}
                  onChange={(e) => update('date_needed', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Fulfilment">
              <Input
                value={form.fulfilment}
                onChange={(e) => update('fulfilment', e.target.value)}
                placeholder="Delivery (Bathurst), Pickup, etc."
              />
            </Field>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Customisation
            </legend>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Design">
                <Select
                  value={form.design_slug}
                  options={designs.map((d) => ({
                    value: d.external_id,
                    label: `${d.external_id.startsWith('bundle:') ? 'Bundle - ' : ''}${d.name}${d.price_cents != null ? ` ($${(d.price_cents / 100).toFixed(0)})` : ''}`,
                  }))}
                  onChange={selectDesign}
                />
              </Field>
              <Field label="Finish">
                <Select
                  value={form.finish_id}
                  options={finishes.map((f) => ({ value: f.external_id, label: f.name }))}
                  onChange={(v) => update('finish_id', v)}
                />
              </Field>
              <Field label="Palette">
                <Select
                  value={form.palette_id}
                  options={palettes.map((p) => ({ value: p.external_id, label: p.name }))}
                  onChange={(v) => update('palette_id', v)}
                />
              </Field>
            </div>

            <Field label="Add-ons">
              <div className="flex flex-wrap gap-1.5">
                {addons.map((a) => {
                  const on = form.addon_ids.includes(a.external_id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAddon(a.external_id)}
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
            </Field>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Payment
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total (AUD)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.total}
                  onChange={(e) => update('total', e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm pt-6">
                <input
                  type="checkbox"
                  checked={form.mark_paid}
                  onChange={(e) => update('mark_paid', e.target.checked)}
                />
                Already paid (verified externally)
              </label>
            </div>
          </fieldset>

          <Field label="Notes">
            <Input
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Optional"
            />
          </Field>

          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isLoading}>
              {create.isLoading ? 'Creating…' : 'Create order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">— None —</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
