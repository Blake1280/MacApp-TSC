import { Loader2 } from 'lucide-react';

/**
 * The one true empty/loading state. Every page used to hand-roll its own
 * ("Loading…" plaintext, raw bordered boxes, a green check here and there) —
 * this wraps the .brand-empty treatment (balloon glyph + Dancing Script
 * tagline) so quiet screens all read the same.
 *
 * Variants:
 *   <EmptyState loading />                     → spinner + "Just a moment…"
 *   <EmptyState tagline="…" message="…" />     → balloon glyph empty state
 *   surface: wrap in its own brand-surface card (for pages where the empty
 *   state isn't already inside a card/table).
 */
export function EmptyState({
  tagline,
  message,
  loading = false,
  surface = false,
}: {
  tagline?: string;
  message?: string;
  loading?: boolean;
  surface?: boolean;
}) {
  const body = loading ? (
    <div className="brand-empty">
      <Loader2 className="glyph h-7 w-7 animate-spin" />
      <div className="text-xs">{message ?? 'Just a moment…'}</div>
    </div>
  ) : (
    <div className="brand-empty">
      <BalloonGlyph />
      {tagline && <div className="tagline">{tagline}</div>}
      {message && <div className="text-xs">{message}</div>}
    </div>
  );

  if (surface) return <div className="brand-surface">{body}</div>;
  return body;
}

function BalloonGlyph() {
  return (
    <svg
      className="glyph"
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <ellipse cx="12" cy="9.5" rx="5.5" ry="6.5" fill="currentColor" fillOpacity="0.18" />
      <path d="M11 16l1 1 1-1" />
      <path d="M12 17c-0.6 1.6 0.6 3.4 0 5" />
    </svg>
  );
}
