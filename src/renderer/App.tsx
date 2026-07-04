import { useEffect } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  ScrollText,
  CloudDownload,
} from 'lucide-react';
import { cn } from './lib/utils';
// The polished brand mark (pink circle + line balloon) — same identity the
// website uses for its favicon/app icon. The old B&W stamp logo lives on in
// logo-original.png if ever needed.
import logoMark from './assets/favicon.svg';
import { trpc } from './trpc';
import DashboardPage from './pages/Dashboard';
import InventoryPage from './pages/Inventory';
import SettingsPage from './pages/Settings';
import ProductsPage from './pages/Products';
import RecipeEditorPage from './pages/RecipeEditor';
import OrdersPage from './pages/Orders';
import OrderDetailPage from './pages/OrderDetail';
import AuditLogPage from './pages/AuditLog';
import WizardPage from './pages/Wizard';
import MarginsPage from './pages/Margins';
import ReorderPage from './pages/Reorder';
import WebOrdersPage from './pages/WebOrders';
import {
  GlyphDashboard,
  GlyphReceipt,
  GlyphBalloon,
  GlyphReorder,
  GlyphMargins,
  GlyphCatalogue,
} from './components/BrandGlyphs';

/* App version — pulled from package.json at build-time via Vite's
   import-attribute-style JSON import. Means the sidebar always reads
   the actual shipped version, not a hand-maintained string. */
import pkg from '../../package.json';
const APP_VERSION = (pkg as { version: string }).version;

const nav = [
  { to: '/dashboard',  label: 'Dashboard',  Icon: GlyphDashboard },
  { to: '/orders',     label: 'Orders',     Icon: GlyphReceipt },
  { to: '/web-orders', label: 'Web orders', Icon: CloudDownload },
  { to: '/inventory',  label: 'Stock',      Icon: GlyphBalloon },
  { to: '/reorder',    label: 'Reorder',    Icon: GlyphReorder },
  { to: '/margins',    label: 'Margins',    Icon: GlyphMargins },
  { to: '/products',   label: 'Catalogue',  Icon: GlyphCatalogue },
  { to: '/audit',      label: 'Audit log',  Icon: ScrollText },
  { to: '/settings',   label: 'Settings',   Icon: SettingsIcon },
];

export default function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<WizardPage />} />
      <Route path="*" element={<MainShell />} />
    </Routes>
  );
}

function MainShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const wizardComplete = trpc.settings.get.useQuery({ key: 'wizard_complete' });
  const catalogue = trpc.catalogue.list.useQuery({});

  // Native app-menu navigation (macOS "Settings… Cmd+," etc.). The preload
  // bridge returns an unsubscribe function, which doubles as the cleanup.
  useEffect(() => {
    const api = (window as { app?: { onMenuNavigate?: (cb: (route: string) => void) => () => void } }).app;
    if (!api?.onMenuNavigate) return;
    return api.onMenuNavigate((route) => navigate(route));
  }, [navigate]);

  // First-run gate: only redirect to /welcome if the wizard hasn't been
  // completed AND the DB is genuinely empty (no catalogue yet). This way
  // existing installs don't get pushed back through the wizard after we
  // shipped it in a later phase.
  const empty = (catalogue.data?.length ?? 0) === 0;
  const ready = !wizardComplete.isLoading && !catalogue.isLoading;

  useEffect(() => {
    if (!ready) return;
    if (
      wizardComplete.data !== '1' &&
      empty &&
      location.pathname !== '/welcome'
    ) {
      navigate('/welcome', { replace: true });
    }
  }, [ready, wizardComplete.data, empty, location.pathname, navigate]);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 flex flex-col">
        <div className="px-5 py-7 flex items-center gap-3">
          <img
            src={logoMark}
            alt="The Sweet Creative"
            className="h-12 w-12 object-contain drop-shadow-sm"
          />
          <div>
            <div className="font-serif-brand text-[19px] leading-none tracking-tight text-ink-900">
              Sweet Creative
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-rose-600 mt-1.5">
              Inventory
            </div>
          </div>
        </div>

        <nav className="px-2 space-y-0.5 flex-1">
          {nav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-ink-700 hover:bg-cream-2 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-4 w-4" filled={isActive} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 pt-3 pb-4 border-t border-border space-y-2">
          <StocktakePill />
          <div className="text-[9px] uppercase tracking-[0.18em] text-ink-300 px-1">
            v{APP_VERSION} · Bathurst
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/web-orders" element={<WebOrdersPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/reorder" element={<ReorderPage />} />
          <Route path="/margins" element={<MarginsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id/recipe" element={<RecipeEditorPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

/**
 * Sidebar pill showing how fresh the stocktake is. Reads the
 * `last_stocktake_at` setting that the stocktake importer stamps on
 * every successful apply. Three states:
 *   - never imported  → muted "No stocktake yet"
 *   - <14 days        → soft "Stocktake N days ago" (good)
 *   - >=14 days       → rose-toned "Stocktake N days ago" (gentle nudge)
 * Click → /inventory, where Jade can see counts and re-run a stocktake.
 */
function StocktakePill() {
  const navigate = useNavigate();
  const last = trpc.settings.get.useQuery(
    { key: 'last_stocktake_at' },
    { refetchInterval: 60_000 },
  );

  if (last.isLoading) return null;

  const iso = last.data;
  let label: string;
  let stale = false;

  if (!iso) {
    label = 'No stocktake yet';
    stale = true;
  } else {
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
    if (days === 0) label = 'Stocktake today';
    else if (days === 1) label = 'Stocktake 1 day ago';
    else label = `Stocktake ${days} days ago`;
    stale = days >= 14;
  }

  return (
    <button
      type="button"
      onClick={() => navigate('/inventory')}
      className={cn(
        'w-full text-left rounded-md px-2.5 py-1.5 text-[11px] tabular-nums transition-colors',
        stale
          ? 'brand-alert-warn brand-alert-warn-strong hover:bg-rose-100/60'
          : 'bg-card/70 text-muted-foreground hover:bg-card hover:text-foreground',
      )}
      title="Click to open Stock"
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle',
          stale ? 'bg-rose-600' : 'bg-success/70',
        )}
      />
      {label}
    </button>
  );
}
