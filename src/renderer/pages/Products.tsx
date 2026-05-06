import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  FileSpreadsheet,
  Upload,
  Sparkles,
  Palette,
  Gift,
  Layers,
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
  CloudUpload,
  PackageOpen,
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
import { formatCents } from '../lib/format';
import type {
  CatalogueEntry,
  CatalogueEntryWithCounts,
  CatalogueKind,
  ImportPreview,
  StocktakePreview,
  StocktakeApplyResult,
} from '@shared/types';

const KIND_LABEL: Record<CatalogueKind, string> = {
  design: 'Designs',
  finish: 'Finishes',
  palette: 'Palettes',
  addon: 'Add-ons',
};

const KIND_SINGULAR: Record<CatalogueKind, string> = {
  design: 'Design',
  finish: 'Finish',
  palette: 'Palette',
  addon: 'Add-on',
};

const KIND_ICON: Record<CatalogueKind, typeof Sparkles> = {
  design: Sparkles,
  finish: Layers,
  palette: Palette,
  addon: Gift,
};

const KIND_DESCRIPTION: Record<CatalogueKind, string> = {
  design: 'Named designs from the website gallery. Recipes here represent any design-specific extras.',
  finish: 'Curled, satin, foil. Each finish recipe deducts the relevant ribbon/topper.',
  palette: 'Colour palettes. Each palette recipe deducts the matching colour balloons (foil orders only).',
  addon: 'Stand-alone add-ons. Auto-seeded as 1:1 inventory items on import.',
};

/** External-id prefix the importer uses for bundles. Letting the renderer
 *  detect bundles from the prefix means we can split the "Designs" kind
 *  into "Bundles" + "Designs" sections without a database round-trip. */
const BUNDLE_EXT_ID_PREFIX = 'bundle:';

function isBundle(entry: CatalogueEntry): boolean {
  return entry.kind === 'design' && entry.external_id.startsWith(BUNDLE_EXT_ID_PREFIX);
}

/** Order bundle categories in the same priority the website uses on
 *  /bundles.html — so Jade's mental model stays consistent across the
 *  customer-facing site and the inventory app. New / unknown categories
 *  fall to the bottom in alpha order. */
const BUNDLE_CATEGORY_ORDER = [
  'For Her',
  'For Him',
  'Birthday',
  'Baby',
  'Gender Reveal',
  'Spoil',
  'Treats',
];

/** Order addon groups in the same priority the website's BYO step 3
 *  shows them — Sweet things first because chocolate is the most-
 *  requested addon, finishing touches last because they're decorative. */
const ADDON_CATEGORY_ORDER = [
  'Sweet things',
  'Drinks',
  'Pantry & food',
  'Homewares',
  'Gift items',
  'Finishing touches',
  'Balloon',
];

/** Sort a category list against a known priority order. Items not in
 *  the priority list fall to the bottom, sorted alphabetically. */
function sortByPriority(categories: string[], priority: string[]): string[] {
  return [...categories].sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function ProductsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const all = trpc.catalogue.list.useQuery({ includeArchived });
  const [importOpen, setImportOpen] = useState(false);
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<CatalogueEntry | null>(null);
  const navigate = useNavigate();

  // Split kind='design' into bundles (external_id starts with 'bundle:')
  // and one-off designs from the gallery. They come from the same SQL kind
  // but render under separate headings — bundles get sub-grouped by their
  // category (For Her, Birthday, etc.) while gallery designs stay flat.
  const allEntries = all.data ?? [];
  const bundleEntries = allEntries.filter(isBundle);
  const designEntries = allEntries.filter((e) => e.kind === 'design' && !isBundle(e));
  const finishEntries = allEntries.filter((e) => e.kind === 'finish');
  const paletteEntries = allEntries.filter((e) => e.kind === 'palette');
  const addonEntries = allEntries.filter((e) => e.kind === 'addon');

  const isEmpty = allEntries.length === 0;

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="page-h1 min-w-0">
          <h1 className="text-3xl font-serif-brand font-medium leading-tight">Catalogue</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            What the website sells — bundles, designs, finishes, palettes and add-ons. Each one has a recipe that decides what stock to deduct when an order arrives.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} title="Pull catalogue + designs from the website's product-data.js">
            <Download className="h-4 w-4" /> Sync from website
          </Button>
          <Button variant="outline" onClick={() => setStocktakeOpen(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Import stocktake
          </Button>
          <ExportStocktakeButton />
          <PushStockButton />

          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add by hand
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {isEmpty && !all.isLoading && (
        <div className="rounded-lg border border-dashed bg-card p-10 text-center space-y-3">
          <h2 className="text-lg font-medium">Catalogue's empty</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Click <strong>Sync from website</strong> to pull everything across in one go, or{' '}
            <strong>Add by hand</strong> for one-offs.
          </p>
        </div>
      )}

      {/* ---- Bundles — grouped by website category ---- */}
      {bundleEntries.length > 0 && (
        <CategorisedSection
          title="Bundles"
          icon={PackageOpen}
          description="Pre-set gift bundles from the website. Each is a fixed gift list — recipe deducts the locked addon contents. Trim addons sit on the order."
          entries={bundleEntries}
          categoryOrder={BUNDLE_CATEGORY_ORDER}
          uncategorisedLabel="Uncategorised"
          onEdit={(e) => setEditEntry(e)}
          onOpenRecipe={(e) => navigate(`/products/${e.id}/recipe`)}
        />
      )}

      {/* ---- One-off designs from the gallery ---- */}
      {designEntries.length > 0 && (
        <FlatSection
          title={KIND_LABEL.design}
          icon={KIND_ICON.design}
          description={KIND_DESCRIPTION.design}
          entries={designEntries}
          onEdit={(e) => setEditEntry(e)}
          onOpenRecipe={(e) => navigate(`/products/${e.id}/recipe`)}
        />
      )}

      {finishEntries.length > 0 && (
        <FlatSection
          title={KIND_LABEL.finish}
          icon={KIND_ICON.finish}
          description={KIND_DESCRIPTION.finish}
          entries={finishEntries}
          onEdit={(e) => setEditEntry(e)}
          onOpenRecipe={(e) => navigate(`/products/${e.id}/recipe`)}
        />
      )}

      {paletteEntries.length > 0 && (
        <FlatSection
          title={KIND_LABEL.palette}
          icon={KIND_ICON.palette}
          description={KIND_DESCRIPTION.palette}
          entries={paletteEntries}
          onEdit={(e) => setEditEntry(e)}
          onOpenRecipe={(e) => navigate(`/products/${e.id}/recipe`)}
        />
      )}

      {/* ---- Add-ons — grouped by website addonGroup ---- */}
      {addonEntries.length > 0 && (
        <CategorisedSection
          title={KIND_LABEL.addon}
          icon={KIND_ICON.addon}
          description={KIND_DESCRIPTION.addon}
          entries={addonEntries}
          categoryOrder={ADDON_CATEGORY_ORDER}
          uncategorisedLabel="Other add-ons"
          onEdit={(e) => setEditEntry(e)}
          onOpenRecipe={(e) => navigate(`/products/${e.id}/recipe`)}
        />
      )}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {stocktakeOpen && <StocktakeImportDialog onClose={() => setStocktakeOpen(false)} />}
      {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} />}
      {editEntry && <EditDialog entry={editEntry} onClose={() => setEditEntry(null)} />}
    </div>
  );
}

/** Flat (un-grouped) section — used for finishes, palettes, and one-off
 *  gallery designs where there's no useful sub-grouping. */
function FlatSection({
  title,
  icon: Icon,
  description,
  entries,
  onEdit,
  onOpenRecipe,
}: {
  title: string;
  icon: typeof Sparkles;
  description: string;
  entries: CatalogueEntryWithCounts[];
  onEdit: (e: CatalogueEntry) => void;
  onOpenRecipe: (e: CatalogueEntry) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-muted-foreground">({entries.length})</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <ProductTable entries={entries} onEdit={onEdit} onOpenRecipe={onOpenRecipe} />
    </section>
  );
}

/** Section that splits its entries into collapsible category sub-groups
 *  (matching the website's bundle / addon group layout). Categories with
 *  zero entries don't render. The first category opens by default so the
 *  page doesn't look empty on first visit. */
function CategorisedSection({
  title,
  icon: Icon,
  description,
  entries,
  categoryOrder,
  uncategorisedLabel,
  onEdit,
  onOpenRecipe,
}: {
  title: string;
  icon: typeof Sparkles;
  description: string;
  entries: CatalogueEntryWithCounts[];
  categoryOrder: string[];
  uncategorisedLabel: string;
  onEdit: (e: CatalogueEntry) => void;
  onOpenRecipe: (e: CatalogueEntry) => void;
}) {
  // Bucket entries by category, with NULL falling into a single
  // 'uncategorised' bucket displayed last.
  const buckets = new Map<string, CatalogueEntryWithCounts[]>();
  for (const e of entries) {
    const key = e.category ?? '__uncat__';
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(e);
  }

  const categories = sortByPriority(
    [...buckets.keys()].filter((k) => k !== '__uncat__'),
    categoryOrder,
  );
  if (buckets.has('__uncat__')) categories.push('__uncat__');

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-muted-foreground">({entries.length})</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>

      <div className="space-y-2">
        {categories.map((cat, index) => {
          const list = buckets.get(cat) ?? [];
          if (list.length === 0) return null;
          const label = cat === '__uncat__' ? uncategorisedLabel : cat;
          return (
            <details
              key={cat}
              open={index === 0}
              className="group rounded-lg border bg-card overflow-hidden"
            >
              <summary className="flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer select-none hover:bg-accent/30 list-none">
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60" />
                  <span className="font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">({list.length})</span>
                </div>
                <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>
              <div className="border-t">
                <ProductTable entries={list} onEdit={onEdit} onOpenRecipe={onOpenRecipe} dense />
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

/** Shared product-row table used by both flat and categorised sections.
 *  Wrapped in `overflow-x-auto` so very wide names don't blow out the
 *  layout when the window is narrow. */
function ProductTable({
  entries,
  onEdit,
  onOpenRecipe,
  dense = false,
}: {
  entries: CatalogueEntryWithCounts[];
  onEdit: (e: CatalogueEntry) => void;
  onOpenRecipe: (e: CatalogueEntry) => void;
  dense?: boolean;
}) {
  return (
    <div className={`${dense ? '' : 'rounded-lg border'} bg-card overflow-x-auto`}>
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-4 py-2.5">Name</th>
            <th className="text-right font-medium px-4 py-2.5 w-24">Price</th>
            <th className="text-right font-medium px-4 py-2.5 w-28">Recipe items</th>
            <th className="text-right font-medium px-4 py-2.5 w-64">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <ProductRow
              key={e.id}
              entry={e}
              onEdit={() => onEdit(e)}
              onOpenRecipe={() => onOpenRecipe(e)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductRow({
  entry,
  onEdit,
  onOpenRecipe,
}: {
  entry: CatalogueEntryWithCounts;
  onEdit: () => void;
  onOpenRecipe: () => void;
}) {
  const utils = trpc.useUtils();
  const archive = trpc.catalogue.setArchived.useMutation({
    onSuccess: () => {
      utils.catalogue.list.invalidate();
    },
  });
  const isArchived = entry.archived === 1;

  return (
    <tr className={`border-t ${isArchived ? 'opacity-60' : 'hover:bg-accent/40'}`}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{entry.name}</span>
          {isArchived && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
              archived
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
        {formatCents(entry.price_cents)}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {entry.recipe_component_count === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-foreground">{entry.recipe_component_count}</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onOpenRecipe} disabled={isArchived}>
            Edit recipe
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} title="Rename / change price">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={isArchived ? 'Restore' : 'Archive (hides without deleting)'}
            onClick={() => archive.mutate({ id: entry.id, archived: !isArchived })}
          >
            {isArchived ? (
              <ArchiveRestore className="h-4 w-4" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.catalogue.create.useMutation({
    onSuccess: () => {
      utils.catalogue.list.invalidate();
      utils.inventory.list.invalidate();
      onClose();
    },
  });

  const [kind, setKind] = useState<CatalogueKind>('addon');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [externalIdTouched, setExternalIdTouched] = useState(false);
  const [price, setPrice] = useState('');
  const [autoCreateInventory, setAutoCreateInventory] = useState(true);

  const effectiveExternalId = externalIdTouched ? externalId : slugify(name);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      kind,
      external_id: effectiveExternalId,
      name: name.trim(),
      price_cents: price ? Math.round(parseFloat(price) * 100) : null,
      autoCreateInventoryItem: autoCreateInventory,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>
            Add a design, finish, palette or add-on by hand. Use this for one-offs that aren't on
            the website yet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Kind" required>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CatalogueKind)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="design">{KIND_SINGULAR.design}</option>
              <option value="finish">{KIND_SINGULAR.finish}</option>
              <option value="palette">{KIND_SINGULAR.palette}</option>
              <option value="addon">{KIND_SINGULAR.addon}</option>
            </select>
          </Field>
          <Field label="Name" required>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === 'design'
                  ? 'e.g. Easter Bunny Duo'
                  : kind === 'addon'
                    ? 'e.g. Cadbury chocolates'
                    : 'Display name'
              }
            />
          </Field>
          <Field
            label="External ID"
            hint="Used to match orders. Lowercase letters, numbers and dashes only. Auto-generated from the name unless edited."
          >
            <Input
              required
              value={effectiveExternalId}
              onChange={(e) => {
                setExternalIdTouched(true);
                setExternalId(e.target.value);
              }}
              pattern="[a-z0-9-]+"
              placeholder={kind === 'addon' ? 'e.g. cadbury-chocolates' : 'e.g. my-new-design'}
            />
          </Field>
          <Field label="Price (AUD, optional)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm pt-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autoCreateInventory}
              onChange={(e) => setAutoCreateInventory(e.target.checked)}
            />
            <span>
              Also create a matching inventory item + 1:1 recipe
              <span className="block text-xs text-muted-foreground">
                Recommended for add-ons. The new SKU will be{' '}
                <code>{kind}-{effectiveExternalId || '…'}</code>.
              </span>
            </span>
          </label>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isLoading || !name || !effectiveExternalId}>
              {create.isLoading ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ entry, onClose }: { entry: CatalogueEntry; onClose: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.catalogue.update.useMutation({
    onSuccess: () => {
      utils.catalogue.list.invalidate();
      onClose();
    },
  });

  const [name, setName] = useState(entry.name);
  const [externalId, setExternalId] = useState(entry.external_id);
  const [price, setPrice] = useState(
    entry.price_cents == null ? '' : (entry.price_cents / 100).toFixed(2),
  );
  const [defaultFinish, setDefaultFinish] = useState(entry.default_finish_id ?? '');
  const [defaultPalette, setDefaultPalette] = useState(entry.default_palette_id ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({
      id: entry.id,
      name: name.trim(),
      external_id: externalId.trim(),
      price_cents: price ? Math.round(parseFloat(price) * 100) : null,
      default_finish_id: entry.kind === 'design' ? defaultFinish.trim() || null : undefined,
      default_palette_id: entry.kind === 'design' ? defaultPalette.trim() || null : undefined,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {KIND_SINGULAR[entry.kind].toLowerCase()}</DialogTitle>
          <DialogDescription>
            Change the name, price or external ID. Don't change the external ID unless you have
            to — it's how orders get matched.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name" required>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="External ID" required>
            <Input
              required
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              pattern="[a-z0-9-]+"
            />
          </Field>
          <Field label="Price (AUD)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          {entry.kind === 'design' && (
            <>
              <Field label="Default finish ID">
                <Input
                  value={defaultFinish}
                  onChange={(e) => setDefaultFinish(e.target.value)}
                  placeholder="e.g. satin"
                />
              </Field>
              <Field label="Default palette ID">
                <Input
                  value={defaultPalette}
                  onChange={(e) => setDefaultPalette(e.target.value)}
                  placeholder="e.g. blush"
                />
              </Field>
            </>
          )}
          {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isLoading}>
              {update.isLoading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const pickPath = trpc.importer.pickPath.useMutation();
  const apply = trpc.importer.apply.useMutation({
    onSuccess: () => {
      utils.catalogue.list.invalidate();
      utils.inventory.list.invalidate();
    },
  });

  const [path, setPath] = useState<string | null>(null);
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoSeed, setAutoSeed] = useState(true);
  // Bundle import is on by default — every product-data.js shipped since
  // April 2026 has the bundles[] array. Kept togglable so a stocktake-only
  // re-run doesn't have to touch bundle catalogue entries.
  const [importBundles, setImportBundles] = useState(true);
  const [seedBundleRecipes, setSeedBundleRecipes] = useState(true);
  // Finish + palette recipe templates — bubble/ribbon/box/pin/care-guide on
  // each finish, 5× latex pack on every palette. On by default so brand-new
  // installs deduct the right balloons + materials from the first order.
  const [seedFinishRecipes, setSeedFinishRecipes] = useState(true);
  const [seedPaletteRecipes, setSeedPaletteRecipes] = useState(true);

  const preview = trpc.importer.preview.useQuery(
    { path: path ?? '' },
    { enabled: !!path, retry: false },
  );

  async function pick() {
    const result = await pickPath.mutateAsync({ kind: 'file' });
    if (result) setPath(result);
  }

  function runApply() {
    if (!path) return;
    apply.mutate({
      path,
      autoCreateAddonInventory: autoCreate,
      autoSeedAddonRecipes: autoSeed && autoCreate,
      importBundles,
      autoSeedBundleRecipes: seedBundleRecipes && importBundles,
      autoSeedFinishRecipes: seedFinishRecipes,
      autoSeedPaletteRecipes: seedPaletteRecipes,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import catalogue</DialogTitle>
          <DialogDescription>
            Reads <code>product-data.js</code> from a folder, the file directly, or a Netlify ZIP.
            Re-importing updates names and prices but never deletes anything.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <Button onClick={pick} variant="outline">
              Choose file or ZIP
            </Button>
            <span className="text-sm text-muted-foreground truncate">{path ?? 'No file selected'}</span>
          </div>

          {preview.error && <p className="text-sm text-destructive">{preview.error.message}</p>}

          {preview.data && <PreviewSummary preview={preview.data} />}

          <div className="space-y-2 pt-2 border-t">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoCreate}
                onChange={(e) => setAutoCreate(e.target.checked)}
              />
              <span>
                Auto-create inventory items for the 9 add-ons
                <span className="block text-xs text-muted-foreground">
                  Creates SKUs like <code>addon-plush</code>, <code>addon-wine</code>. Safe — won't
                  overwrite existing items.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!autoCreate}
                checked={autoSeed && autoCreate}
                onChange={(e) => setAutoSeed(e.target.checked)}
              />
              <span>
                Auto-seed 1:1 add-on recipes
                <span className="block text-xs text-muted-foreground">
                  Each add-on's recipe deducts 1× of its matching inventory item. Recommended.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={importBundles}
                onChange={(e) => setImportBundles(e.target.checked)}
              />
              <span>
                Import pre-set bundles
                <span className="block text-xs text-muted-foreground">
                  Each bundle imports as a Catalogue 'design' entry (external_id <code>bundle:&lt;id&gt;</code>)
                  with default finish/palette so bundle orders show up correctly in Catalogue, Margins
                  and projection. Stock deduction still flows through each locked addon — bundles
                  don't double-deduct.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!importBundles}
                checked={seedBundleRecipes && importBundles}
                onChange={(e) => setSeedBundleRecipes(e.target.checked)}
              />
              <span>
                Auto-seed bundle recipes
                <span className="block text-xs text-muted-foreground">
                  On first creation only. Each bundle's recipe gets one component per locked addon
                  (qty 1). Re-imports leave existing recipes alone so your manual edits stick.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={seedFinishRecipes}
                onChange={(e) => setSeedFinishRecipes(e.target.checked)}
              />
              <span>
                Auto-seed finish recipes (bubble + ribbon + box + pin + care guide)
                <span className="block text-xs text-muted-foreground">
                  Every order deducts 1× <code>balloon-bubble-24in</code> + 1× ribbon (matched to
                  finish) + 1× <code>gift-box-medium</code> + 1× <code>sc-pin</code> + 1× <code>care-guide-card</code>.
                  Foil orders skip the ribbon line — the foil topper pool is picked manually.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={seedPaletteRecipes}
                onChange={(e) => setSeedPaletteRecipes(e.target.checked)}
              />
              <span>
                Auto-seed palette recipes (5× latex cluster)
                <span className="block text-xs text-muted-foreground">
                  Every palette deducts 5× <code>balloon-latex-5in-pack</code>. Specific colours
                  are hand-matched on the day so individual colour SKUs aren't auto-wired.
                </span>
              </span>
            </label>
          </div>

          {apply.error && <p className="text-sm text-destructive">{apply.error.message}</p>}
          {apply.data && <ApplySummary result={apply.data} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {apply.data ? 'Done' : 'Cancel'}
          </Button>
          <Button type="button" disabled={!preview.data || apply.isLoading} onClick={runApply}>
            {apply.isLoading ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
      <div className="text-xs text-muted-foreground">Found at: {preview.source_path}</div>
      <div className="grid grid-cols-5 gap-3 pt-2">
        <Stat label="Designs" value={preview.designs.length} />
        <Stat label="Finishes" value={preview.finishes.length} />
        <Stat label="Palettes" value={preview.palettes.length} />
        <Stat label="Add-ons" value={preview.addons.length} />
        <Stat label="Bundles" value={preview.bundles.length} />
      </div>
    </div>
  );
}

function ApplySummary({ result }: { result: import('@shared/types').ImportResult }) {
  return (
    <div className="rounded-md brand-alert-ok p-3 text-sm space-y-1">
      <div className="font-medium">Imported successfully.</div>
      <ul className="text-xs opacity-80 space-y-0.5">
        <li>
          Inserted: {result.inserted.designs} designs, {result.inserted.finishes} finishes,{' '}
          {result.inserted.palettes} palettes, {result.inserted.addons} add-ons,{' '}
          {result.inserted.bundles} bundles
        </li>
        <li>
          Updated: {result.updated.designs} designs, {result.updated.finishes} finishes,{' '}
          {result.updated.palettes} palettes, {result.updated.addons} add-ons,{' '}
          {result.updated.bundles} bundles
        </li>
        <li>Inventory items auto-created: {result.inventoryAutoCreated}</li>
        <li>Add-on recipes auto-seeded (1:1): {result.recipesAutoSeeded}</li>
        <li>Bundle recipe components seeded: {result.bundleRecipesAutoSeeded}</li>
        <li>Finish recipe components seeded: {result.finishRecipesAutoSeeded}</li>
        <li>Palette recipe components seeded: {result.paletteRecipesAutoSeeded}</li>
      </ul>
      {(result.bundleRecipeWarnings.length > 0 || result.finishRecipeWarnings.length > 0) && (
        <div className="mt-2 text-xs">
          <div className="font-medium">
            Warnings ({result.bundleRecipeWarnings.length + result.finishRecipeWarnings.length}):
          </div>
          <ul className="opacity-80 space-y-0.5 pl-4 list-disc max-h-32 overflow-auto">
            {result.bundleRecipeWarnings.map((w, i) => (
              <li key={`b${i}`}>{w}</li>
            ))}
            {result.finishRecipeWarnings.map((w, i) => (
              <li key={`f${i}`}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExportStocktakeButton() {
  const pickPath = trpc.stocktake.pickExportPath.useMutation();
  const exportXlsx = trpc.stocktake.export.useMutation();
  const [done, setDone] = useState<{ path: string; count: number; sheets: number } | null>(null);

  async function run() {
    setDone(null);
    const path = await pickPath.mutateAsync(undefined);
    if (!path) return;
    const result = await exportXlsx.mutateAsync({ path });
    setDone(result);
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={run} disabled={pickPath.isLoading || exportXlsx.isLoading}>
        <Upload className="h-4 w-4" />
        {exportXlsx.isLoading ? 'Exporting…' : 'Export stocktake (XLSX)'}
      </Button>
      {done && (
        <span className="text-xs text-muted-foreground">
          ✓ {done.count} items, {done.sheets} tabs → {done.path.split(/[\\/]/).pop()}
        </span>
      )}
      {exportXlsx.error && (
        <span className="text-xs text-destructive">{exportXlsx.error.message}</span>
      )}
    </div>
  );
}

/** Pushes the current inventory snapshot to the website's Supabase mirror.
 *  The website reads stock_levels for "only N left" badges. Run this after
 *  a stocktake or whenever stock levels meaningfully change. */
function PushStockButton() {
  const push = trpc.tscWeb.pushStock.useMutation();
  const [done, setDone] = useState<{ count: number; at: string } | null>(null);

  async function run() {
    setDone(null);
    const result = await push.mutateAsync();
    setDone({ count: result.itemsUpserted, at: new Date().toLocaleTimeString() });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        onClick={run}
        disabled={push.isLoading}
        title="Send the current stock counts up to the website so 'only N left' badges reflect reality"
      >
        <CloudUpload className="h-4 w-4" />
        {push.isLoading ? 'Pushing…' : 'Push stock to website'}
      </Button>
      {done && (
        <span className="text-xs text-muted-foreground">
          ✓ {done.count} items pushed at {done.at}
        </span>
      )}
      {push.error && (
        <span className="text-xs text-destructive">{push.error.message}</span>
      )}
    </div>
  );
}

function StocktakeImportDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const pickPath = trpc.stocktake.pickPath.useMutation();
  const apply = trpc.stocktake.apply.useMutation({
    onSuccess: () => {
      utils.catalogue.list.invalidate();
      utils.inventory.list.invalidate();
    },
  });

  const [path, setPath] = useState<string | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [upsertCat, setUpsertCat] = useState(true);
  const [upsertRec, setUpsertRec] = useState(true);
  const [ackStale, setAckStale] = useState(false);
  const [archiveMissing, setArchiveMissing] = useState(false);

  const preview = trpc.stocktake.preview.useQuery(
    { path: path ?? '' },
    { enabled: !!path, retry: false },
  );

  // Reset the stale-acknowledgement whenever the file changes — a new
  // workbook may be fresh, in which case the checkbox shouldn't carry over.
  function pickAndReset() {
    setAckStale(false);
    pick();
  }
  async function pick() {
    const result = await pickPath.mutateAsync(undefined);
    if (result) setPath(result);
  }

  const freshness = preview.data?.freshness;
  const needsAck = freshness && freshness.status !== 'fresh';
  const canApply = !!preview.data && (!needsAck || ackStale);

  function runApply() {
    if (!path) return;
    apply.mutate({
      path,
      createMissingInventory: createMissing,
      upsertCatalogue: upsertCat,
      upsertRecipes: upsertRec,
      acknowledgeStale: ackStale,
      archiveMissing: archiveMissing,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import stocktake (XLSX)</DialogTitle>
          <DialogDescription>
            Reads the multi-sheet stocktake workbook (Inventory_Items, Catalogue_Entries, Recipes).
            Existing rows are matched by SKU / external_id and updated in place — never duplicated.
            On-hand changes write a <code>correction</code> stock movement so the audit trail stays intact.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <Button onClick={pickAndReset} variant="outline">
              Choose XLSX
            </Button>
            <span className="text-sm text-muted-foreground truncate">{path ?? 'No file selected'}</span>
          </div>

          {preview.error && <p className="text-sm text-destructive">{preview.error.message}</p>}

          {preview.data && (
            <>
              <FreshnessBanner
                freshness={preview.data.freshness}
                acknowledged={ackStale}
                onAcknowledge={setAckStale}
              />
              <StocktakePreviewSummary preview={preview.data} />
            </>
          )}

          <div className="space-y-2 pt-2 border-t">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
              />
              <span>
                Create new inventory items if SKU not yet in the database
                <span className="block text-xs text-muted-foreground">
                  Off = update on-hand counts only; rows with unknown SKUs are skipped.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={upsertCat}
                onChange={(e) => setUpsertCat(e.target.checked)}
              />
              <span>
                Upsert catalogue entries from the Catalogue_Entries sheet
                <span className="block text-xs text-muted-foreground">
                  Same as the Import-from-website action — names, prices and design defaults.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={upsertRec}
                onChange={(e) => setUpsertRec(e.target.checked)}
              />
              <span>
                Upsert recipes from the Recipes sheet
                <span className="block text-xs text-muted-foreground">
                  Maps each catalogue entry to the inventory items it consumes (with quantities).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm border-t pt-2 mt-1">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={archiveMissing}
                onChange={(e) => setArchiveMissing(e.target.checked)}
              />
              <span>
                <span className={archiveMissing ? 'text-destructive font-medium' : ''}>
                  Archive items missing from this workbook
                </span>
                <span className="block text-xs text-muted-foreground">
                  Off by default. Tick when this workbook is a complete-shop count and you want
                  rows you've removed from the sheet to disappear from the app too. Items are
                  soft-archived (history kept) — never hard-deleted.
                </span>
              </span>
            </label>
          </div>

          {apply.error && <p className="text-sm text-destructive">{apply.error.message}</p>}
          {apply.data && <StocktakeApplySummary result={apply.data} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {apply.data ? 'Done' : 'Cancel'}
          </Button>
          <Button
            type="button"
            disabled={!canApply || apply.isLoading}
            onClick={runApply}
            title={!canApply && needsAck ? 'Tick the acknowledgement above first' : ''}
          >
            {apply.isLoading ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FreshnessBanner({
  freshness,
  acknowledged,
  onAcknowledge,
}: {
  freshness: StocktakePreview['freshness'];
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}) {
  if (freshness.status === 'fresh') {
    if (!freshness.lastMovementAt) return null;
    return (
      <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
        ✓ Workbook is up-to-date (exported{' '}
        {new Date(freshness.generatedAt).toLocaleString()}).
      </div>
    );
  }
  if (freshness.status === 'stale') {
    const exported = new Date(freshness.generatedAt).toLocaleString();
    const lastMove = new Date(freshness.lastMovementAt).toLocaleString();
    return (
      <div className="rounded-md border-2 border-destructive bg-red-50 px-3 py-3 text-sm space-y-2">
        <div className="font-medium text-destructive">⚠ Stale stocktake</div>
        <div className="text-foreground">
          This file was exported on <strong>{exported}</strong>.{' '}
          <strong>{freshness.movementsSince} stock movement(s)</strong> have been recorded since
          then (last one {lastMove}).
        </div>
        <div className="text-foreground">
          Importing will overwrite those counts. If you want the most recent state, click{' '}
          <strong>Cancel</strong>, click <strong>Export stocktake (XLSX)</strong> first, then re-do
          your counts in the fresh file.
        </div>
        <label className="flex items-start gap-2 text-sm pt-1">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
          />
          <span className="font-medium text-destructive">
            I know — apply anyway (overwrites the {freshness.movementsSince} newer movement
            {freshness.movementsSince === 1 ? '' : 's'})
          </span>
        </label>
      </div>
    );
  }
  // unknown
  return (
    <div className="rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-3 text-sm space-y-2">
      <div className="font-medium text-amber-900">⚠ Can't verify when this file was made</div>
      <div className="text-foreground">{freshness.reason}</div>
      <label className="flex items-start gap-2 text-sm pt-1">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        <span className="font-medium text-amber-900">
          I trust this file — apply anyway
        </span>
      </label>
    </div>
  );
}

function StocktakePreviewSummary({ preview }: { preview: StocktakePreview }) {
  const tally = (rows: StocktakePreview['inventory']) => ({
    new: rows.filter((r) => r.status === 'new').length,
    update: rows.filter((r) => r.status === 'update').length,
    unchanged: rows.filter((r) => r.status === 'unchanged').length,
    error: rows.filter((r) => r.status === 'error').length,
  });
  const inv = tally(preview.inventory);
  const cat = tally(preview.catalogue as unknown as StocktakePreview['inventory']);
  const rec = tally(preview.recipes as unknown as StocktakePreview['inventory']);
  const errorRows = [
    ...preview.inventory.filter((r) => r.status === 'error').slice(0, 3),
    ...preview.catalogue.filter((r) => r.status === 'error').slice(0, 3),
    ...preview.recipes.filter((r) => r.status === 'error').slice(0, 3),
  ];

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-3">
      <div className="text-xs text-muted-foreground">Source: {preview.source_path}</div>
      <div className="grid grid-cols-3 gap-3">
        <PreviewBlock label="Inventory items" tally={inv} />
        <PreviewBlock label="Catalogue entries" tally={cat} />
        <PreviewBlock label="Recipes" tally={rec} />
      </div>
      {preview.warnings.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
          {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      {errorRows.length > 0 && (
        <div className="text-xs text-destructive bg-red-50 rounded px-2 py-1.5 space-y-0.5">
          <div className="font-medium">Rows with errors (first few):</div>
          {errorRows.map((r, i) => <div key={i}>• {r.reason}</div>)}
        </div>
      )}
    </div>
  );
}

function PreviewBlock({
  label,
  tally,
}: {
  label: string;
  tally: { new: number; update: number; unchanged: number; error: number };
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="space-y-0.5 text-sm">
        <div>+ {tally.new} new</div>
        <div>↻ {tally.update} updated</div>
        <div className="text-muted-foreground">{tally.unchanged} unchanged</div>
        {tally.error > 0 && <div className="text-destructive">! {tally.error} errors</div>}
      </div>
    </div>
  );
}

function StocktakeApplySummary({ result }: { result: StocktakeApplyResult }) {
  return (
    <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm space-y-1">
      <div className="font-medium">Stocktake imported successfully.</div>
      <ul className="text-xs text-muted-foreground space-y-0.5">
        <li>
          Inventory: {result.inventory.created} created, {result.inventory.updated} updated,{' '}
          {result.inventory.stockAdjusted} on-hand counts changed
          {result.inventory.archived > 0 && (
            <span>, <strong className="text-destructive">{result.inventory.archived} archived</strong></span>
          )}
        </li>
        <li>
          Catalogue: {result.catalogue.created} created, {result.catalogue.updated} updated
        </li>
        <li>
          Recipes: {result.recipes.upserted} upserted, {result.recipes.skipped} skipped
        </li>
      </ul>
      {result.warnings.length > 0 && (
        <div className="text-xs text-amber-700 mt-2 space-y-0.5">
          {result.warnings.slice(0, 5).map((w, i) => <div key={i}>⚠ {w}</div>)}
          {result.warnings.length > 5 && <div>…and {result.warnings.length - 5} more</div>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
