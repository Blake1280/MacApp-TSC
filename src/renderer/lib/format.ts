const audFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return audFormatter.format(cents / 100);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}
