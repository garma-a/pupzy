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
