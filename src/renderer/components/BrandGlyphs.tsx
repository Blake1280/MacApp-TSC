/* The Sweet Creative — sidebar glyphs.
 *
 * Tiny custom SVGs that replace the lucide stock icons in the sidebar so
 * the nav reads like *this* business — bubble balloons, a tied bow, a
 * shopping-cart-with-balloon, etc. — instead of generic Lucide.
 *
 * Each glyph accepts a `filled` prop. When the nav item is active the
 * sidebar renders the icon on top of `--primary` (rose-600), so we
 * switch the strokes to currentColor and let the wrapper handle colour.
 */

type GlyphProps = {
  className?: string;
  filled?: boolean;
};

function base(props: GlyphProps) {
  return {
    className: props.className,
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

/** Dashboard — a 2×2 grid of cards, each one slightly different size for
 *  visual weight. Subtle nod to the actual dashboard layout. */
export function GlyphDashboard(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <rect x="3"  y="3"  width="7" height="9" rx="1.5" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.2" />
      <rect x="14" y="3"  width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.2" />
      <rect x="3"  y="15" width="7" height="6" rx="1.5" />
    </svg>
  );
}

/** Orders / Receipt — simple receipt with a serrated bottom and two lines. */
export function GlyphReceipt(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 3h14v17l-2.5-1.5L14 20l-2-1-2 1-2.5-1.5L5 20V3z" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.18" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

/** Stock — a bubble balloon (the hero product). Round bubble + the
 *  little knot at the bottom + a wisp of ribbon. */
export function GlyphBalloon(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="9.5" rx="5.5" ry="6.5" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.18" />
      <path d="M11 16l1 1 1-1" />
      <path d="M12 17c-0.6 1.6 0.6 3.4 0 5" />
    </svg>
  );
}

/** Reorder — a balloon over a small shopping basket / handle. The "we
 *  need more of this" glyph. */
export function GlyphReorder(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="6" rx="3.5" ry="4" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.18" />
      <path d="M11.4 10l0.6 1 0.6-1" />
      <path d="M12 11v3" />
      <path d="M5 14h14l-1.5 6h-11L5 14z" />
      <path d="M9 17v2M15 17v2" />
    </svg>
  );
}

/** Margins — a downward trend line (cost vs revenue gap). */
export function GlyphMargins(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 17l5-5 4 3 8-9" />
      <path d="M14 6h6v6" />
      <path d="M3 21h18" />
    </svg>
  );
}

/** Catalogue — a tied bow (the website's signature finish), echoing the
 *  hand-tied ribbon flourishes on the storefront. */
export function GlyphCatalogue(props: GlyphProps) {
  return (
    <svg {...base(props)}>
      {/* Two ribbon loops */}
      <path d="M12 12c-3-3-7-3-7 0 0 3 4 4 7 1" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.18" />
      <path d="M12 12c3-3 7-3 7 0 0 3-4 4-7 1" fill={props.filled ? 'currentColor' : 'none'} fillOpacity="0.18" />
      {/* Knot in the middle */}
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      {/* Tail ribbons */}
      <path d="M10 13l-2 7M14 13l2 7" />
    </svg>
  );
}
