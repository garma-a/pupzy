/** "2 h ago": the age of an open case, kept coarse on purpose. The exact time is in the tooltip. */
export function relativeAge(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(time).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3 reports" / "1 report" / "No reports". */
export function reportCountLabel(count) {
  const number = Number(count) || 0;
  if (number === 0) return 'No reports';
  return number === 1 ? '1 report' : `${number} reports`;
}

/**
 * The Inbox's query string. A default value is left out so the plain Inbox URL
 * stays `<root>` and a remembered filter round-trips exactly.
 */
export function inboxSearch({ kind = 'all', order = 'oldest', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (kind !== 'all') params.set('kind', kind);
  if (order !== 'oldest') params.set('order', order);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** The case page for an Inbox row; `returnTo` brings the moderator back to the same filter and page. */
export function caseHref(target, inboxPath, rootPath = '/admin') {
  const base = `${rootPath}/resources/${encodeURIComponent(target.resource)}/records/${encodeURIComponent(target.id)}/show`;
  return `${base}?returnTo=${encodeURIComponent(inboxPath)}`;
}

const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

/**
 * The numbers beside the list heading. A report tile counts reports while the
 * list shows one row per target, so it gives both ("4 cases, 5 reports"). A
 * Post tile and the whole Inbox count cases only.
 */
export function headingCounts({ reports = false, cases = 0, reportCount = 0 }) {
  return reports ? `${plural(cases, 'case')}, ${plural(reportCount, 'report')}` : cases.toLocaleString();
}
