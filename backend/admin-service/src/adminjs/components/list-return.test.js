import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIST_SEARCH_STORAGE_PREFIX,
  filteredListBackLink,
  recallListSearch,
  rememberListSearch,
  reportReviewHref,
  inboxBackHref,
  inboxReturnFromSearch,
  safeReturnPath,
} from './list-return.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    get size() {
      return values.size;
    },
  };
}

describe('Admin list return state', () => {
  it('remembers the filtered list search per resource', () => {
    const storage = createStorage();
    rememberListSearch('posts', '?filters.moderation_status=FLAGGED&filters.status=ACTIVE', storage);
    assert.equal(recallListSearch('posts', storage), '?filters.moderation_status=FLAGGED&filters.status=ACTIVE');
    assert.equal(recallListSearch('users', storage), '', 'another resource keeps its own state');
    assert.equal(storage.size, 1);
  });

  it('clears a resource entry when its list has no query', () => {
    const storage = createStorage();
    rememberListSearch('posts', '?filters.status=EXPIRED', storage);
    rememberListSearch('posts', '', storage);
    assert.equal(recallListSearch('posts', storage), '');
  });

  it('tolerates missing or throwing storage', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    assert.doesNotThrow(() => rememberListSearch('posts', '?filters.status=EXPIRED', throwingStorage));
    assert.equal(recallListSearch('posts', throwingStorage), '');
    assert.equal(recallListSearch('posts'), '', 'no storage means no remembered search');
    assert.equal(LIST_SEARCH_STORAGE_PREFIX, 'pupzy:list-search:');
  });

  it('builds a filtered back link only for a filtered list', () => {
    assert.deepEqual(filteredListBackLink('?filters.moderation_status=FLAGGED', '/admin'), {
      href: '/admin/resources/posts?filters.moderation_status=FLAGGED',
      label: 'Back to filtered list',
    });
    assert.deepEqual(filteredListBackLink('', '/admin'), {
      href: '/admin/resources/posts',
      label: 'Back to Posts list',
    });
    assert.deepEqual(filteredListBackLink('?page=2', '/admin'), {
      href: '/admin/resources/posts',
      label: 'Back to Posts list',
    });
    assert.equal(
      filteredListBackLink('?filters.status=EXPIRED', '/custom').href,
      '/custom/resources/posts?filters.status=EXPIRED',
    );
  });
});

describe('report review return target', () => {
  const workspace = '/admin/resources/posts/records/0194-abc/show?refresh=true';

  it('links an open report straight to its review form and carries the workspace as the return target', () => {
    const href = reportReviewHref('post_reports', 'report-1', workspace);
    assert.equal(
      href,
      `/admin/resources/post_reports/records/report-1/reviewWithNoAction?returnTo=${encodeURIComponent(workspace)}`,
    );
    assert.equal(safeReturnPath(new URL(href, 'http://x').searchParams.get('returnTo')), workspace);
    assert.equal(
      reportReviewHref('post_reports', 'report-1', ''),
      '/admin/resources/post_reports/records/report-1/reviewWithNoAction',
    );
  });

  it('only returns to record pages inside this admin', () => {
    assert.equal(
      safeReturnPath('/admin/resources/rescue_posts/records/abc-1/show'),
      '/admin/resources/rescue_posts/records/abc-1/show',
    );
    for (const unsafe of [
      'https://evil.example/admin/resources/posts/records/1/show',
      '//evil.example/admin/resources/posts/records/1/show',
      '/admin/resources/posts/records/1/delete',
      '/admin/../evil',
      'javascript:alert(1)',
      '/admin/resources/posts/records/1/show#x y',
      '',
      null,
      undefined,
    ]) {
      assert.equal(safeReturnPath(unsafe), null, String(unsafe));
    }
  });
  it('accepts the Inbox, with its filter and page, as a return path', () => {
    for (const inbox of ['/admin', '/admin/', '/admin?kind=flagged&order=newest&page=2']) {
      assert.equal(safeReturnPath(inbox), inbox, inbox);
    }
    for (const unsafe of ['/administrator', '/admin/other', '//evil.example', '/admin?x=1#frag', '/admin?x= 1']) {
      assert.equal(safeReturnPath(unsafe), null, unsafe);
    }
  });

  it('sends "Back to inbox" to the same filter and page', () => {
    const storage = createStorage();
    const inbox = '/admin?kind=post_report&page=2';
    const search = `?returnTo=${encodeURIComponent(inbox)}`;
    assert.equal(inboxReturnFromSearch(search), inbox);
    assert.equal(inboxBackHref(search, '/admin', storage), inbox, 'the link in the page wins');

    assert.equal(inboxBackHref('', '/admin', storage), '/admin', 'nothing remembered: the plain Inbox');
    rememberListSearch('inbox', '?kind=flagged&order=newest', storage);
    assert.equal(inboxBackHref('', '/admin', storage), '/admin?kind=flagged&order=newest');

    const recordReturn = `?returnTo=${encodeURIComponent('/admin/resources/posts/records/p-1/show')}`;
    assert.equal(inboxReturnFromSearch(recordReturn), null, 'a record page is not the Inbox');
    assert.equal(inboxBackHref(recordReturn, '/admin', storage), '/admin?kind=flagged&order=newest');

    rememberListSearch('inbox', 'javascript:alert(1)', storage);
    assert.equal(inboxBackHref('', '/admin', storage), '/admin', 'a tampered memory is ignored');
  });
});
