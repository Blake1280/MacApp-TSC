import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../lib/toast';
import { formatDate } from '../lib/format';
import pkg from '../../../package.json';

const APP_VERSION = (pkg as { version: string }).version;

export default function SettingsPage() {
  const website = trpc.tscWeb.status.useQuery();
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header className="page-h1">
        <h1 className="text-3xl font-serif-brand font-medium leading-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One secure website connection keeps orders and stock shared across every device.
        </p>
      </header>

      <WebsiteConnectionSection />
      {!website.data?.connected && <StripeSection />}
      {!website.data?.connected && <NetlifySection />}
      <EmailNotificationsSection />
      <SyncBehaviourSection />
      <PreferencesSection />
      <BackupSection />
      <DemoDataSection />

      <AboutSection />
    </div>
  );
}

function WebsiteConnectionSection() {
  const utils = trpc.useUtils();
  const status = trpc.tscWeb.status.useQuery();
  const [apiKey, setApiKey] = useState('');
  const connect = trpc.tscWeb.connect.useMutation({
    onSuccess: () => {
      setApiKey('');
      utils.tscWeb.status.invalidate();
    },
  });
  const disconnect = trpc.tscWeb.disconnect.useMutation({
    onSuccess: () => utils.tscWeb.status.invalidate(),
  });
  const push = trpc.tscWeb.pushCloudInventory.useMutation({ onSuccess: () => utils.inventory.list.invalidate() });
  const pull = trpc.tscWeb.pullCloudInventory.useMutation({ onSuccess: () => utils.inventory.list.invalidate() });

  return (
    <section className="brand-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Sweet Creative website</h2>
          <p className="text-xs text-muted-foreground">
            Cloud source of truth for website orders, payment status and inventory on Windows, Mac and phones.
          </p>
        </div>
        <ConnectionBadge connected={status.data?.connected ?? false} />
      </div>
      {status.data?.connected ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-700">
            Connected. Stripe and Netlify secrets stay on the website server; this app only uses the protected shared API.
          </p>
          <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => pull.mutate()} disabled={pull.isLoading}>
            <RefreshCw className={`h-4 w-4 ${pull.isLoading ? 'animate-spin' : ''}`} />
            {pull.isLoading ? 'Pulling...' : 'Pull cloud stock'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => push.mutate()} disabled={push.isLoading}>
            {push.isLoading ? 'Publishing...' : 'Publish this stock'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()}>
            Disconnect this computer
          </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (apiKey.trim()) connect.mutate({ apiKey });
          }}
        >
          <Input
            type="password"
            placeholder="Website connection key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="font-mono text-xs"
          />
          <Button type="submit" disabled={!apiKey.trim() || connect.isLoading}>
            {connect.isLoading ? 'Testing...' : 'Test & save'}
          </Button>
        </form>
      )}
      {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
    </section>
  );
}

function StripeSection() {
  const utils = trpc.useUtils();
  const status = trpc.stripe.status.useQuery();
  const connect = trpc.stripe.connect.useMutation({
    onSuccess: () => {
      utils.stripe.status.invalidate();
      utils.sync.state.invalidate();
      runSync.mutate();
      setApiKey('');
    },
  });
  const disconnect = trpc.stripe.disconnect.useMutation({
    onSuccess: () => utils.stripe.status.invalidate(),
  });
  const runSync = trpc.sync.runStripe.useMutation({
    onSuccess: () => {
      utils.stripe.status.invalidate();
      utils.orders.list.invalidate();
      utils.sync.state.invalidate();
    },
  });

  const [apiKey, setApiKey] = useState('');
  const isConnected = status.data?.connected ?? false;
  const encryptionAvailable = status.data?.encryption_available ?? true;

  return (
    <section className="brand-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Stripe</h2>
          <p className="text-xs text-muted-foreground">
            Pulls paid Checkout Sessions every 5 minutes.
          </p>
        </div>
        <ConnectionBadge connected={isConnected} />
      </div>

      {!encryptionAvailable && (
        <div className="brand-alert-danger p-3 text-sm">
          OS-level encryption isn't available — secrets can't be stored safely.
        </div>
      )}

      {isConnected ? (
        <div className="space-y-3">
          <div className="text-sm grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Last successful sync</div>
              <div className="tabular-nums">{formatDate(status.data?.last_synced_at)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last error</div>
              <div className="text-destructive">{status.data?.last_error ?? '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runSync.mutate()}
              disabled={runSync.isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${runSync.isLoading ? 'animate-spin' : ''}`} />
              {runSync.isLoading ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isLoading}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste a Stripe <strong>restricted</strong> API key (starts with <code>rk_live_</code> or
            <code> rk_test_</code>). Create one at{' '}
            <span className="font-mono text-xs">Dashboard → Developers → API keys → Create
            restricted key</span>{' '}
            with read access to <em>Checkout Sessions</em> only.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (apiKey.trim()) connect.mutate({ apiKey });
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="password"
              placeholder="rk_live_…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-xs"
            />
            <Button type="submit" disabled={!apiKey.trim() || connect.isLoading}>
              {connect.isLoading ? 'Testing…' : 'Test & save'}
            </Button>
          </form>
          {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
        </div>
      )}
    </section>
  );
}

function NetlifySection() {
  const utils = trpc.useUtils();
  const status = trpc.netlify.status.useQuery();
  const connect = trpc.netlify.connect.useMutation({
    onSuccess: () => {
      utils.netlify.status.invalidate();
      setToken('');
    },
  });
  const disconnect = trpc.netlify.disconnect.useMutation({
    onSuccess: () => utils.netlify.status.invalidate(),
  });
  const runSync = trpc.sync.runNetlify.useMutation({
    onSuccess: () => {
      utils.netlify.status.invalidate();
      utils.orders.list.invalidate();
    },
  });

  const [token, setToken] = useState('');
  const isConnected = status.data?.connected ?? false;
  const targetSet = !!status.data?.form_id;

  return (
    <section className="brand-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Netlify Forms — failsafe order source</h2>
          <p className="text-xs text-muted-foreground">
            Captures every BYO form submission, even when Stripe doesn't confirm. The canonical
            source for design / palette / add-on details.
          </p>
        </div>
        <ConnectionBadge connected={isConnected && targetSet} />
      </div>

      {isConnected ? (
        <div className="space-y-3">
          {targetSet ? (
            <div className="brand-surface-inset p-3 text-sm space-y-1">
              <div>
                <span className="text-xs text-muted-foreground">Site:</span>{' '}
                <strong>{status.data?.site_name}</strong>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Form:</span>{' '}
                <strong>{status.data?.form_name}</strong>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                Last sync: {formatDate(status.data?.last_synced_at)}
              </div>
              {status.data?.last_error && (
                <div className="text-xs text-destructive">Error: {status.data.last_error}</div>
              )}
            </div>
          ) : (
            <SiteFormPicker onSet={() => utils.netlify.status.invalidate()} />
          )}

          <div className="flex items-center gap-2">
            {targetSet && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => runSync.mutate()}
                disabled={runSync.isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${runSync.isLoading ? 'animate-spin' : ''}`} />
                {runSync.isLoading ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isLoading}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste a Netlify <strong>personal access token</strong>. Create one at{' '}
            <a
              href="https://app.netlify.com/user/applications/personal"
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-0.5"
            >
              Netlify → User settings → Applications → Personal access tokens
              <ExternalLink className="h-3 w-3" />
            </a>
            . The token only needs default read access.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim()) connect.mutate({ token });
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="password"
              placeholder="Netlify personal access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-xs"
            />
            <Button type="submit" disabled={!token.trim() || connect.isLoading}>
              {connect.isLoading ? 'Testing…' : 'Test & save'}
            </Button>
          </form>
          {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
        </div>
      )}
    </section>
  );
}

function SiteFormPicker({ onSet }: { onSet: () => void }) {
  const sites = trpc.netlify.listSites.useQuery();
  const [siteId, setSiteId] = useState<string>('');
  const [siteName, setSiteName] = useState<string>('');
  const forms = trpc.netlify.listForms.useQuery(
    { site_id: siteId },
    { enabled: !!siteId },
  );
  const setTarget = trpc.netlify.setTarget.useMutation({ onSuccess: onSet });

  return (
    <div className="space-y-2">
      <p className="text-sm">Choose your site and the BYO order form.</p>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={siteId}
          onChange={(e) => {
            const id = e.target.value;
            setSiteId(id);
            setSiteName(sites.data?.find((s) => s.id === id)?.name ?? '');
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">— Choose a site —</option>
          {sites.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          disabled={!siteId || forms.isLoading}
          onChange={(e) => {
            const formId = e.target.value;
            const formName = forms.data?.find((f) => f.id === formId)?.name ?? '';
            if (siteId && formId) {
              setTarget.mutate({
                site_id: siteId,
                site_name: siteName,
                form_id: formId,
                form_name: formName,
              });
            }
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">
            {forms.isLoading
              ? 'Loading forms…'
              : forms.data?.length === 0
                ? '(no forms on this site)'
                : '— Choose a form —'}
          </option>
          {forms.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.submission_count})
            </option>
          ))}
        </select>
      </div>
      {sites.error && <p className="text-sm text-destructive">{sites.error.message}</p>}
    </div>
  );
}

function PreferencesSection() {
  const utils = trpc.useUtils();
  const all = trpc.settings.all.useQuery();
  const set = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.all.invalidate(),
  });
  const toast = useToast();

  // Helpers to get the current value (with defaults baked in) so each input
  // can be a controlled component without a useEffect hop.
  const getStr = (key: string, fallback: string): string => {
    const row = all.data?.find((r) => r.key === key);
    return row?.value ?? fallback;
  };
  const getNum = (key: string, fallback: number): number => {
    const v = getStr(key, '');
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const [defaultReorderAt, setDefaultReorderAt] = useState<string>('');
  const [defaultUnit, setDefaultUnit] = useState<string>('');
  const [confirmAdjustAbove, setConfirmAdjustAbove] = useState<string>('');

  // Hydrate the inputs once the query lands. Empty-string while loading
  // so we don't overwrite the saved value with a default.
  if (all.data && defaultReorderAt === '' && defaultUnit === '' && confirmAdjustAbove === '') {
    setDefaultReorderAt(String(getNum('prefs.default_reorder_at', 3)));
    setDefaultUnit(getStr('prefs.default_unit', 'each'));
    setConfirmAdjustAbove(String(getNum('prefs.confirm_adjust_above', 50)));
  }

  async function save() {
    const updates: Array<{ key: string; value: string }> = [
      { key: 'prefs.default_reorder_at', value: String(Math.max(0, Number(defaultReorderAt) || 0)) },
      { key: 'prefs.default_unit', value: defaultUnit.trim() || 'each' },
      { key: 'prefs.confirm_adjust_above', value: String(Math.max(0, Number(confirmAdjustAbove) || 0)) },
    ];
    for (const u of updates) {
      await set.mutateAsync(u);
    }
    toast.toast({ title: 'Preferences saved', variant: 'success' });
  }

  return (
    <section className="brand-surface p-5 space-y-3">
      <div>
        <h2 className="font-medium">Quality of life</h2>
        <p className="text-xs text-muted-foreground">
          Defaults that get pre-filled when you create a new item or adjust stock. Skip a field
          to keep the existing value.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Default reorder threshold</span>
          <Input
            type="number"
            min="0"
            value={defaultReorderAt}
            onChange={(e) => setDefaultReorderAt(e.target.value)}
            placeholder="3"
          />
          <span className="text-[11px] text-muted-foreground">
            Pre-filled in the "Reorder at" box when adding a new item.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Default unit</span>
          <Input
            value={defaultUnit}
            onChange={(e) => setDefaultUnit(e.target.value)}
            placeholder="each"
            list="unit-options"
          />
          <span className="text-[11px] text-muted-foreground">
            Pre-filled in the "Unit" box (each / pack / roll / metres / sheet / bag / bottle).
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Confirm-above threshold</span>
          <Input
            type="number"
            min="0"
            value={confirmAdjustAbove}
            onChange={(e) => setConfirmAdjustAbove(e.target.value)}
            placeholder="50"
          />
          <span className="text-[11px] text-muted-foreground">
            Asks "are you sure?" when an Add or Sale moves stock by more than this.
          </span>
        </label>
      </div>

      <div className="pt-1">
        <Button size="sm" onClick={save} disabled={set.isLoading}>
          {set.isLoading ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </section>
  );
}

function BackupSection() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const dbPath = trpc.backup.dbPath.useQuery();
  const exportDb = trpc.backup.exportToFile.useMutation({
    onSuccess: (r) => {
      if (r.canceled) return;
      toast({
        title: 'Backup saved',
        description: r.path,
        variant: 'success',
      });
    },
    onError: (e) =>
      toast({ title: 'Backup failed', description: e.message, variant: 'error' }),
  });
  const reset = trpc.backup.resetAllData.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast({ title: 'All data reset', variant: 'warning' });
      setConfirming(false);
    },
    onError: (e) => toast({ title: 'Reset failed', description: e.message, variant: 'error' }),
  });
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="brand-surface p-5 space-y-3">
      <div>
        <h2 className="font-medium">Backup & data</h2>
        <p className="text-xs text-muted-foreground">
          Database: <code className="text-xs">{dbPath.data ?? '…'}</code>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportDb.mutate()}
          disabled={exportDb.isLoading}
        >
          <Download className="h-4 w-4" />
          {exportDb.isLoading ? 'Saving…' : 'Export backup file'}
        </Button>
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                reset.mutate({ confirm: 'I understand this deletes everything' })
              }
              disabled={reset.isLoading}
            >
              <AlertTriangle className="h-4 w-4" />
              {reset.isLoading ? 'Resetting…' : 'Yes, wipe everything'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Reset all data
          </Button>
        )}
      </div>
      {confirming && (
        <p className="text-xs text-destructive">
          This deletes every order, every inventory item, every catalogue entry, every stock
          movement, and disconnects Stripe + Netlify. The schema rebuilds empty.
        </p>
      )}
    </section>
  );
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="brand-pill brand-pill-ok">
      <CheckCircle2 className="h-3 w-3" /> Connected
    </span>
  ) : (
    <span className="brand-pill bg-muted text-muted-foreground">
      <XCircle className="h-3 w-3" /> Not connected
    </span>
  );
}

function DemoDataSection() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const seed = trpc.settings.seedDemoOrders.useMutation({
    onSuccess: (r) => {
      toast.toast({
        title: 'Demo data seeded',
        description: `${r.created} new, ${r.alreadyPresent} already present` +
          (r.warnings.length > 0 ? ` · ${r.warnings.length} warning(s)` : ''),
        variant: r.warnings.length > 0 ? 'warning' : 'success',
      });
      utils.orders.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.inventory.projection.invalidate();
    },
  });
  const clear = trpc.settings.clearDemoOrders.useMutation({
    onSuccess: (r) => {
      toast.toast({
        title: 'Demo data cleared',
        description: `${r.removed} demo order${r.removed === 1 ? '' : 's'} removed`,
        variant: 'success',
      });
      utils.orders.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.inventory.projection.invalidate();
    },
  });

  return (
    <section className="brand-surface p-5 space-y-3">
      <div>
        <h2 className="font-medium">Demo data</h2>
        <p className="text-xs text-muted-foreground">
          Plant 4 sample orders dated this week and next so the Margins, Reserved-stock and
          Reorder pages render with realistic numbers. Every demo order's Stripe id starts
          with <code className="px-1 bg-muted rounded">DEMO-</code> — easy to spot and
          easy to clear.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isLoading}>
          {seed.isLoading ? 'Seeding…' : 'Seed demo orders'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => clear.mutate()}
          disabled={clear.isLoading}
        >
          {clear.isLoading ? 'Clearing…' : 'Clear demo orders'}
        </Button>
      </div>
    </section>
  );
}

function SyncBehaviourSection() {
  const utils = trpc.useUtils();
  const setting = trpc.settings.get.useQuery({ key: 'auto_apply_stripe_orders' });
  const set = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'auto_apply_stripe_orders' }),
  });
  // Default ON: setting null/'1' both mean enabled.
  const enabled = setting.data === null || setting.data === undefined ? true : setting.data !== '0';

  function toggle() {
    set.mutate({ key: 'auto_apply_stripe_orders', value: enabled ? '0' : '1' });
  }

  return (
    <section className="brand-surface p-5 space-y-3">
      <div>
        <h2 className="font-medium">Sync behaviour</h2>
        <p className="text-xs text-muted-foreground">
          Automatic actions taken when Stripe orders pull in.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={set.isLoading}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="text-sm font-medium">Auto-apply stock for confirmed orders</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            When a paid order arrives via Stripe and Netlify (both sources confirm), automatically
            confirm it and deduct its recipe from stock. Orders with unresolved recipes or
            single-source confirmation are still left for manual review.
          </div>
        </div>
      </label>
    </section>
  );
}

/**
 * About card. Reads the version live from package.json (so the line never
 * drifts from the actual shipped build) and shows where the inventory DB
 * lives — useful when Brett needs to point Jade at the file for backup.
 */
function AboutSection() {
  return (
    <section className="brand-surface p-5 space-y-2 text-sm">
      <h2 className="font-medium">About</h2>
      <p className="text-muted-foreground">
        Sweet Creative Inventory{' '}
        <span className="font-mono tabular-nums">v{APP_VERSION}</span>{' '}
        · Bathurst NSW. Built for Jade.
      </p>
    </section>
  );
}

/**
 * Email notification status — controls the dashboard banner reminding
 * Jade to check the app daily while her inbox is offline. The banner
 * defaults to shown on a fresh install (since the GoDaddy email
 * setup is still being wired); flipping the toggle here mirrors the
 * "Mark email as working" button on the dashboard banner.
 *
 * If email breaks again later (e.g., GoDaddy outage, MX record drift),
 * Brett or Jade can come back here and turn the reminder on so the
 * banner re-appears.
 */
function EmailNotificationsSection() {
  const utils = trpc.useUtils();
  const setting = trpc.settings.get.useQuery({ key: 'email_notifications_offline' });
  const set = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'email_notifications_offline' }),
  });
  // '0' = working (banner hidden). Anything else (including unset) = offline.
  const offline = setting.data !== '0';
  return (
    <section className="brand-surface p-5 space-y-3 text-sm">
      <div>
        <h2 className="font-medium">Email notifications</h2>
        <p className="text-muted-foreground mt-1">
          Whether the <code>Jade@thesweetcreative.com.au</code> inbox is
          reliably receiving Netlify Forms order notifications. When this
          is set to "offline," the dashboard shows a banner reminding
          Jade to check the app daily for new orders. Toggle to "working"
          once SPF + MX records are confirmed and a test email has landed.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={!offline}
          onChange={(e) => set.mutate({
            key: 'email_notifications_offline',
            value: e.target.checked ? '0' : '1',
          })}
        />
        <div>
          <div className="font-medium">Email is working</div>
          <div className="text-xs text-muted-foreground">
            Hides the "check this dashboard daily" banner. Tick this
            once order notification emails are landing in the inbox.
          </div>
        </div>
      </label>
    </section>
  );
}
