/**
 * Typed wrapper around the generic settings table for "quality-of-life"
 * preferences. These are renderer-only — the values aren't read by the
 * sync engine or any backend job; they exist purely to make daily use of
 * the app a bit nicer (defaults for new items, confirm thresholds, etc.).
 *
 * Storage: each preference lives under a single row in the `settings`
 * table, prefixed `prefs.*`. Values are stored as strings (the schema
 * column is TEXT) and parsed back when read.
 */
import { trpc } from '../trpc';

export const PREF_KEYS = {
  defaultReorderAt: 'prefs.default_reorder_at',
  defaultUnit: 'prefs.default_unit',
  confirmAdjustAbove: 'prefs.confirm_adjust_above',
} as const;

export type PrefKey = (typeof PREF_KEYS)[keyof typeof PREF_KEYS];

export type Prefs = {
  defaultReorderAt: number;
  defaultUnit: string;
  confirmAdjustAbove: number;
};

export const PREF_DEFAULTS: Prefs = {
  defaultReorderAt: 3,
  defaultUnit: 'each',
  confirmAdjustAbove: 50,
};

/**
 * React hook that reads all settings via tRPC and returns the typed prefs
 * with sensible defaults applied. Re-renders whenever a `settings.set`
 * mutation invalidates the query.
 */
export function usePrefs(): Prefs {
  const { data } = trpc.settings.all.useQuery();
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(row.key, row.value);
  const parseInt = (key: string, fallback: number): number => {
    const v = map.get(key);
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    defaultReorderAt: parseInt(PREF_KEYS.defaultReorderAt, PREF_DEFAULTS.defaultReorderAt),
    defaultUnit: map.get(PREF_KEYS.defaultUnit) || PREF_DEFAULTS.defaultUnit,
    confirmAdjustAbove: parseInt(PREF_KEYS.confirmAdjustAbove, PREF_DEFAULTS.confirmAdjustAbove),
  };
}
