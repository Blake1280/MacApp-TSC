import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { EmptyState } from '../components/EmptyState';
import type { CatalogueEntry, InventoryItem, RecipeComponentWithItem } from '@shared/types';

export default function RecipeEditorPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = Number(params.id);

  const entry = trpc.catalogue.byId.useQuery({ id }, { enabled: Number.isFinite(id) && id > 0 });
  const components = trpc.catalogue.recipeComponents.useQuery(
    { catalogue_id: id },
    { enabled: Number.isFinite(id) && id > 0 },
  );
  const inventory = trpc.inventory.list.useQuery({});

  const utils = trpc.useUtils();
  const upsert = trpc.catalogue.upsertRecipeComponent.useMutation({
    onSuccess: () => {
      utils.catalogue.recipeComponents.invalidate({ catalogue_id: id });
      utils.catalogue.list.invalidate();
    },
  });
  const remove = trpc.catalogue.deleteRecipeComponent.useMutation({
    onSuccess: () => {
      utils.catalogue.recipeComponents.invalidate({ catalogue_id: id });
      utils.catalogue.list.invalidate();
    },
  });

  const [newItemId, setNewItemId] = useState<string>('');
  const [newQty, setNewQty] = useState<number>(1);

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Invalid recipe id.</p>
        <Button variant="ghost" onClick={() => navigate('/products')}>
          <ArrowLeft className="h-4 w-4" /> Back to products
        </Button>
      </div>
    );
  }

  const usedIds = new Set((components.data ?? []).map((c) => c.inventory_item_id));
  const availableInventory = (inventory.data ?? []).filter((i: InventoryItem) => !usedIds.has(i.id));

  function add() {
    if (!newItemId || newQty <= 0) return;
    upsert.mutate(
      {
        catalogue_id: id,
        inventory_item_id: Number(newItemId),
        quantity: newQty,
      },
      {
        onSuccess: () => {
          setNewItemId('');
          setNewQty(1);
        },
      },
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-3xl">
      <button
        onClick={() => navigate('/products')}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back to products
      </button>

      {entry.data && <RecipeHeader entry={entry.data} />}

      <section className="brand-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Inventory item</th>
              <th className="text-left font-medium px-4 py-2.5">SKU</th>
              <th className="text-right font-medium px-4 py-2.5">Quantity per order</th>
              <th className="px-4 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {(components.data ?? []).map((c: RecipeComponentWithItem) => (
              <RecipeRow
                key={c.id}
                component={c}
                onUpdate={(qty) =>
                  upsert.mutate({
                    catalogue_id: id,
                    inventory_item_id: c.inventory_item_id,
                    quantity: qty,
                  })
                }
                onDelete={() => remove.mutate({ id: c.id })}
              />
            ))}
            {components.data && components.data.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState message="No items in this recipe yet. Add one below." />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="border-t p-4 bg-muted/30">
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1.5 flex-1">
              <span className="text-xs font-medium text-muted-foreground">Add inventory item</span>
              <select
                value={newItemId}
                onChange={(e) => setNewItemId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Choose an item —</option>
                {availableInventory.map((i: InventoryItem) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 w-32">
              <span className="text-xs font-medium text-muted-foreground">Qty per order</span>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={newQty}
                onChange={(e) => setNewQty(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <Button onClick={add} disabled={!newItemId || newQty <= 0 || upsert.isLoading}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          {availableInventory.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              All inventory items are already in this recipe. Create more inventory items in the
              Inventory page first.
            </p>
          )}
          {upsert.error && <p className="mt-2 text-sm text-destructive">{upsert.error.message}</p>}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        When an order arrives that uses this {entry.data?.kind ?? 'item'}, every row above is
        deducted from on-hand. Quantities can be fractional (e.g. <code>0.5</code> for half a
        ribbon spool).
      </p>
    </div>
  );
}

function RecipeHeader({ entry }: { entry: CatalogueEntry }) {
  return (
    <header>
      <div className="brand-label">{entry.kind}</div>
      <h1 className="text-2xl font-serif-brand font-medium leading-tight">{entry.name}</h1>
      <div className="text-sm text-muted-foreground">
        <span className="font-mono">{entry.external_id}</span>
        {entry.default_finish_id && (
          <> · default finish: <span className="font-mono">{entry.default_finish_id}</span></>
        )}
        {entry.default_palette_id && (
          <> · default palette: <span className="font-mono">{entry.default_palette_id}</span></>
        )}
      </div>
    </header>
  );
}

function RecipeRow({
  component,
  onUpdate,
  onDelete,
}: {
  component: RecipeComponentWithItem;
  onUpdate: (qty: number) => void;
  onDelete: () => void;
}) {
  const [qty, setQty] = useState(component.quantity);
  const dirty = qty !== component.quantity;

  return (
    <tr className="border-t">
      <td className="px-4 py-2.5">{component.inventory_name}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
        {component.inventory_sku}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <Input
            type="number"
            min="0"
            step="0.1"
            value={qty}
            onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))}
            className="w-24 text-right tabular-nums"
          />
          <span className="text-xs text-muted-foreground w-12">{component.inventory_unit}</span>
          {dirty && (
            <Button size="sm" variant="outline" onClick={() => onUpdate(qty)}>
              Save
            </Button>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Button size="icon" variant="ghost" onClick={onDelete} title="Remove from recipe">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </td>
    </tr>
  );
}
