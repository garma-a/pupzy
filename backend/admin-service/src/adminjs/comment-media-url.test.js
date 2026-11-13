import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commentMediaBase, commentMediaPurgeUrls, resolveCommentMediaUrl } from './comment-media-url.js';

describe('Comment media URLs', () => {
  it('cleans the storage key and the base', () => {
    assert.equal(
      resolveCommentMediaUrl('/comments/c1/a.webp', { COMMENT_MEDIA_CDN_BASE: 'https://media.example.test///' }),
      'https://media.example.test/comments/c1/a.webp',
    );
    assert.equal(resolveCommentMediaUrl('///', {}), null);
    assert.equal(resolveCommentMediaUrl(undefined, {}), null);
    assert.equal(resolveCommentMediaUrl(42, {}), null);
  });

  it('picks the base from COMMENT_MEDIA_CDN_BASE, then R2_PUBLIC_URL, then the default CDN', () => {
    assert.equal(
      commentMediaBase({ COMMENT_MEDIA_CDN_BASE: 'https://a.test', R2_PUBLIC_URL: 'https://b.test' }),
      'https://a.test',
    );
    assert.equal(commentMediaBase({ R2_PUBLIC_URL: 'https://b.test/' }), 'https://b.test');
    assert.equal(commentMediaBase({}), 'https://cdn.pupzy.net');
  });

  it('purges only the configured URL unless a domain transition is configured', () => {
    assert.deepEqual(commentMediaPurgeUrls('/k.webp', { R2_PUBLIC_URL: 'https://b.test' }), ['https://b.test/k.webp']);
    assert.deepEqual(
      commentMediaPurgeUrls('k.webp', { R2_PUBLIC_URL: 'https://b.test', COMMENT_MEDIA_DOMAIN_TRANSITION: 'true' }),
      ['https://b.test/k.webp', 'https://cdn.pupzy.net/k.webp'],
    );
    assert.deepEqual(
      commentMediaPurgeUrls('k.webp', {
        COMMENT_MEDIA_CDN_BASE: 'https://new.test',
        COMMENT_MEDIA_PREVIOUS_CDN_BASE: 'https://old.test/',
      }),
      ['https://new.test/k.webp', 'https://cdn.pupzy.net/k.webp', 'https://old.test/k.webp'],
    );
  });
});
