import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

/**
 * "A sync source is erroring" banner — was copy-pasted (with drift) in
 * Dashboard and Orders. Only renders when there is at least one failure.
 */
export function SyncFailureBanner({
  failures,
  onRetry,
  retrying,
}: {
  failures: Array<{ source: string; error: string }>;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (failures.length === 0) return null;
  return (
    <section className="brand-alert-danger px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-medium">Sync failure</div>
          <ul className="text-xs opacity-90 mt-1 space-y-0.5">
            {failures.map((f) => (
              <li key={f.source}>
                <span className="font-medium">{f.source}:</span> {f.error}
              </li>
            ))}
          </ul>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          Retry
        </Button>
      </div>
    </section>
  );
}
