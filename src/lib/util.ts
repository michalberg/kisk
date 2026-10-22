export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escaped text with **bold**, ==highlight== and non-breaking spaces after Czech one-letter prepositions. */
export function rich(s: string | undefined): string {
  if (!s) return '';
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, '<em class="hl">$1</em>')
    .replace(/(^|[\s(„])([kvszaiouKVSZAIOU]) /g, '$1$2&nbsp;');
}

export function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

export function votesLabel(n: number): string {
  return `${n} ${plural(n, 'hlas', 'hlasy', 'hlasů')}`;
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: keep going without it */
  }
}

/** Plain text without inline markup. */
export function plain(s: string | undefined): string {
  return (s || '').replace(/\*\*|==/g, '');
}
