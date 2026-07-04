import { cn } from '../lib/utils';

/**
 * Segmented filter row — the "All / New / Confirmed / …" chip strips that
 * Orders, Audit log, Web orders, Margins and Stock each rebuilt with
 * slightly different classes. One component so active/hover/focus states
 * match everywhere.
 */
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md brand-surface p-0.5 flex-wrap">
      {options.map((o) => {
        const active = value === o.value;
        const count = counts?.[o.value];
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'px-3 py-1 text-xs rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
          >
            {o.label}
            {count != null && count > 0 && (
              <span className={cn('ml-1 tabular-nums', active ? 'opacity-80' : 'opacity-60')}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
