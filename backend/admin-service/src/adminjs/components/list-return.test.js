import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIST_SEARCH_STORAGE_PREFIX,
  filteredListBackLink,
  recallListSearch,
  rememberListSearch,
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
