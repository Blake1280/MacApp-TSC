import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Sparkles,
  CreditCard,
  FileText,
  Boxes,
} from 'lucide-react';
import { trpc } from '../trpc';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../lib/toast';
import logo from '../assets/favicon.svg';
import type { ImportPreview } from '@shared/types';

const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'netlify', label: 'Netlify' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'done', label: 'Done' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export default function WizardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<StepKey>('welcome');
  const utils = trpc.useUtils();

  const markComplete = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.get.invalidate({ key: 'wizard_complete' }),
  });

  function complete() {
    markComplete.mutate({ key: 'wizard_complete', value: '1' });
    navigate('/dashboard');
    toast({
      title: 'Setup complete',
      description: 'You can re-run any of these steps from Settings or Products.',
      variant: 'success',
    });
  }

  function skip() {
    markComplete.mutate({ key: 'wizard_complete', value: '1' });
    navigate('/dashboard');
  }

  const currentIndex = STEPS.findIndex((s) => s.key === step);
  const next = () =>
    setStep(STEPS[Math.min(currentIndex + 1, STEPS.length - 1)].key as StepKey);
  const prev = () =>
    setStep(STEPS[Math.max(currentIndex - 1, 0)].key as StepKey);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Logo" className="h-10 w-10 object-contain" />
            <div>
              <div className="font-serif text-xl tracking-tight">Sweet Creative</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-rose-600">
                Inventory · Setup
              </div>
            </div>
          </div>
          <button
            onClick={skip}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip setup
          </button>
        </header>

        <Stepper currentIndex={currentIndex} />

        <div className="mt-8 brand-surface p-8">
          {step === 'welcome' && <Welcome onNext={next} />}
          {step === 'stripe' && <StripeStep onNext={next} onBack={prev} />}
          {step === 'netlify' && <NetlifyStep onNext={next} onBack={prev} />}
          {step === 'catalogue' && <CatalogueStep onNext={next} onBack={prev} />}
          {step === 'done' && <DoneStep onFinish={complete} onBack={prev} />}
        </div>
      </div>
    </div>
  );
}

function Stepper({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const active = i === currentIndex;
        const done = i < currentIndex;
        return (
          <li key={s.key} className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className={`flex items-center gap-1.5 ${
                active
                  ? 'text-rose-600 font-medium'
                  : done
                    ? 'text-ink-500'
                    : 'text-muted-foreground'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums border ${
                  active
                    ? 'bg-rose-600 text-cream border-rose-600'
                    : done
                      ? 'bg-ink-500 text-cream border-ink-500'
                      : 'bg-card border-border'
                }`}
              >
                {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </span>
              <span className="truncate">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="flex-1 h-px bg-border" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-serif font-medium leading-tight">
          Welcome, Jade.
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Let's get the inventory app pointed at your shop. This takes about three minutes —
          three connections and a one-time catalogue import. You can skip any step and come back
          later from Settings.
        </p>
      </div>
      <div className="space-y-2 text-sm">
        <Bullet icon={CreditCard} text="Stripe — pulls every paid Checkout Session" />
        <Bullet icon={FileText} text="Netlify Forms — failsafe so no order ever slips" />
        <Bullet icon={Sparkles} text="Catalogue — designs, finishes, palettes, add-ons from your website" />
        <Bullet icon={Boxes} text="Inventory — your real on-hand counts (you'll add these any time)" />
      </div>
      <div className="flex justify-end">
        <Button onClick={onNext}>
          Get started <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Bullet({ icon: Icon, text }: { icon: typeof Sparkles; text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-foreground">
      <Icon className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function StripeStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const utils = trpc.useUtils();
  const status = trpc.stripe.status.useQuery();
  const connect = trpc.stripe.connect.useMutation({
    onSuccess: () => {
      utils.stripe.status.invalidate();
      setKey('');
    },
  });
  const [key, setKey] = useState('');

  const connected = status.data?.connected ?? false;

  return (
    <div className="space-y-4">
      <StepHeader
        title="Connect Stripe"
        description="Paste a restricted API key with read access to Checkout Sessions. We'll test it before saving."
      />

      {connected ? (
        <div className="brand-alert-ok p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Connected.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Generate a key at{' '}
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-0.5"
            >
              Dashboard → Developers → API keys
              <ExternalLink className="h-3 w-3" />
            </a>
            . Choose <strong>Create restricted key</strong>, give Checkout Sessions read access, and
            paste here.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) connect.mutate({ apiKey: key.trim() });
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="password"
              placeholder="rk_live_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="font-mono text-xs"
            />
            <Button type="submit" disabled={!key.trim() || connect.isLoading}>
              {connect.isLoading ? 'Testing…' : 'Test & save'}
            </Button>
          </form>
          {connect.error && (
            <p className="text-sm text-destructive">{connect.error.message}</p>
          )}
        </div>
      )}

      <FooterNav onBack={onBack} onNext={onNext} nextLabel={connected ? 'Continue' : 'Skip for now'} />
    </div>
  );
}

function NetlifyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const utils = trpc.useUtils();
  const status = trpc.netlify.status.useQuery();
  const connect = trpc.netlify.connect.useMutation({
    onSuccess: () => {
      utils.netlify.status.invalidate();
      setToken('');
    },
  });
  const sites = trpc.netlify.listSites.useQuery(undefined, { enabled: status.data?.connected });
  const [siteId, setSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const forms = trpc.netlify.listForms.useQuery(
    { site_id: siteId },
    { enabled: !!siteId },
  );
  const setTarget = trpc.netlify.setTarget.useMutation({
    onSuccess: () => utils.netlify.status.invalidate(),
  });

  const [token, setToken] = useState('');
  const connected = status.data?.connected ?? false;
  const targetSet = !!status.data?.form_id;

  return (
    <div className="space-y-4">
      <StepHeader
        title="Connect Netlify"
        description="The failsafe — every form submission is captured here, even when Stripe doesn't confirm payment."
      />

      {!connected ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Generate a token at{' '}
            <a
              href="https://app.netlify.com/user/applications/personal"
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-0.5"
            >
              User settings → Applications → Personal access tokens
              <ExternalLink className="h-3 w-3" />
            </a>
            .
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
      ) : !targetSet ? (
        <div className="space-y-3">
          <p className="text-sm">Token saved. Now pick the site and order form:</p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setSiteName(sites.data?.find((s) => s.id === e.target.value)?.name ?? '');
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
                  ? 'Loading…'
                  : forms.data?.length === 0
                    ? '(no forms)'
                    : '— Choose a form —'}
              </option>
              {forms.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="brand-alert-ok p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Connected to{' '}
          <strong>{status.data?.site_name}</strong> · form{' '}
          <strong>{status.data?.form_name}</strong>.
        </div>
      )}

      <FooterNav
        onBack={onBack}
        onNext={onNext}
        nextLabel={connected && targetSet ? 'Continue' : 'Skip for now'}
      />
    </div>
  );
}

function CatalogueStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const utils = trpc.useUtils();
  const pickPath = trpc.importer.pickPath.useMutation();
  const apply = trpc.importer.apply.useMutation({
    onSuccess: () => {
      utils.catalogue.list.invalidate();
      utils.inventory.list.invalidate();
    },
  });
  const catalogue = trpc.catalogue.list.useQuery({});

  const [path, setPath] = useState<string | null>(null);
  const preview = trpc.importer.preview.useQuery(
    { path: path ?? '' },
    { enabled: !!path, retry: false },
  );

  const alreadyHas = (catalogue.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <StepHeader
        title="Import your catalogue"
        description="Reads designs, finishes, palettes and add-ons from your website's product-data.js. Point at the Netlify ZIP, an unzipped folder, or the JS file directly."
      />

      {alreadyHas && (
        <div className="brand-alert-ok p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {catalogue.data?.length} catalogue entries already imported.
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={async () => {
            const r = await pickPath.mutateAsync({ kind: 'file' });
            if (r) setPath(r);
          }}
        >
          {alreadyHas ? 'Re-import / update' : 'Choose file or ZIP'}
        </Button>
        <span className="text-xs text-muted-foreground truncate">{path ?? 'No file selected'}</span>
      </div>

      {preview.error && <p className="text-sm text-destructive">{preview.error.message}</p>}
      {preview.data && <PreviewSummary preview={preview.data} />}

      {preview.data && !apply.data && (
        <div className="flex justify-end">
          <Button
            onClick={() =>
              apply.mutate({
                path: path!,
                autoCreateAddonInventory: true,
                autoSeedAddonRecipes: true,
              })
            }
            disabled={apply.isLoading}
          >
            {apply.isLoading ? 'Importing…' : 'Import everything'}
          </Button>
        </div>
      )}
      {apply.error && <p className="text-sm text-destructive">{apply.error.message}</p>}
      {apply.data && (
        <div className="brand-alert-ok p-3 text-sm space-y-0.5">
          <div>
            Imported: {apply.data.inserted.designs}D / {apply.data.inserted.finishes}F /{' '}
            {apply.data.inserted.palettes}P / {apply.data.inserted.addons}A /{' '}
            {apply.data.inserted.bundles}B
          </div>
          <div className="text-xs opacity-80">
            {apply.data.inventoryAutoCreated} inventory items auto-created ·{' '}
            {apply.data.recipesAutoSeeded} addon recipes ·{' '}
            {apply.data.bundleRecipesAutoSeeded} bundle components ·{' '}
            {apply.data.finishRecipesAutoSeeded} finish components ·{' '}
            {apply.data.paletteRecipesAutoSeeded} palette components seeded.
          </div>
        </div>
      )}

      <FooterNav
        onBack={onBack}
        onNext={onNext}
        nextLabel={alreadyHas || apply.data ? 'Continue' : 'Skip for now'}
      />
    </div>
  );
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  const tiles = useMemo(
    () => [
      { label: 'Designs', value: preview.designs.length },
      { label: 'Finishes', value: preview.finishes.length },
      { label: 'Palettes', value: preview.palettes.length },
      { label: 'Add-ons', value: preview.addons.length },
    ],
    [preview],
  );
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground mb-2">Found at: {preview.source_path}</div>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DoneStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <StepHeader
        title="You're set up."
        description="One last thing before you start: enter your real on-hand counts in the Inventory page when you're ready. The dashboard will surface low-stock alerts automatically."
      />
      <ul className="text-sm space-y-1.5 text-foreground">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-rose-600 mt-0.5" />
          Orders pull every five minutes (and on demand from the Dashboard).
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-rose-600 mt-0.5" />
          Tap <strong>Confirm</strong> on each order to deduct stock by recipe.
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-rose-600 mt-0.5" />
          For phone or market sales, use <strong>Manual order</strong> on the Orders page.
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-rose-600 mt-0.5" />
          Back up your database from <strong>Settings → Backup &amp; data</strong> — once a week
          is plenty.
        </li>
      </ul>
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onFinish}>
          Open the dashboard <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-2xl font-serif font-medium leading-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  );
}

function FooterNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex justify-between pt-2">
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" /> Back
      </Button>
      <Button onClick={onNext} variant="outline">
        {nextLabel} <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
