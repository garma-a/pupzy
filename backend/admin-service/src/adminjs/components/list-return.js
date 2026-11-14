export const LIST_SEARCH_STORAGE_PREFIX = 'pupzy:list-search:';

function storageTarget(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  return null;
}

/**
 * Remembers the query string of a list page when a staff member opens one of
 * its records, so the record page can offer a return to the same filtered
 * queue. Session storage is per browser tab and admin-only UI state.
 */
export function rememberListSearch(resourceId, search, storage) {
  const target = storageTarget(storage);
  if (!target || !resourceId) return;
  try {
    if (search) target.setItem(`${LIST_SEARCH_STORAGE_PREFIX}${resourceId}`, search);
    else target.removeItem(`${LIST_SEARCH_STORAGE_PREFIX}${resourceId}`);
  } catch {
    // Storage can be unavailable (private mode); the back link then falls back to the plain list.
  }
}

export function recallListSearch(resourceId, storage) {
  const target = storageTarget(storage);
  if (!target || !resourceId) return '';
  try {
    return target.getItem(`${LIST_SEARCH_STORAGE_PREFIX}${resourceId}`) ?? '';
  } catch {
    return '';
  }
}

/**
 * Builds the return link for the Posts list. A remembered filtered list keeps
 * its filters so staff return to the same queue instead of an unfiltered list.
 */
export function filteredListBackLink(search, rootPath = '/admin') {
  const query = typeof search === 'string' ? search : '';
  const hasFilters = /(^\?|&)filters\./.test(query);
  return {
    href: `${rootPath}/resources/posts${hasFilters ? query : ''}`,
    label: hasFilters ? 'Back to filtered list' : 'Back to Posts list',
  };
}

export function adminRootPath() {
  return (typeof window !== 'undefined' && window.REDUX_STATE && window.REDUX_STATE.paths?.rootPath) || '/admin';
}

/**
 * Accepts a `returnTo` only when it is a record page inside this admin
 * (`<root>/resources/<resource>/records/<id>/show`, optional query). Anything
 * else (another site, protocol-relative or script URLs) is ignored so a crafted
 * link cannot send a moderator elsewhere after an action.
 */
export function safeReturnPath(value, rootPath = '/admin') {
  if (typeof value !== 'string') return null;
  const escapedRoot = rootPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedRoot}/resources/[A-Za-z0-9_-]+/records/[A-Za-z0-9-]+/show(\\?[^#\\s]*)?$`);
  return pattern.test(value) ? value : null;
}

/**
 * Link to a report's review form that brings the moderator back to
 * `returnTo` (the Post review workspace) once the review is saved.
 */
export function reportReviewHref(resourceId, reportId, returnTo, rootPath = '/admin') {
  const base = `${rootPath}/resources/${encodeURIComponent(resourceId)}/records/${encodeURIComponent(reportId)}/reviewWithNoAction`;
  return returnTo ? `${base}?returnTo=${encodeURIComponent(returnTo)}` : base;
}
