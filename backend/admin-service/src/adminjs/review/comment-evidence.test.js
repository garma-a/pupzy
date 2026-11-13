import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attachCommentEvidence, buildCommentEvidence, loadCommentEvidence } from './comment-evidence.js';

const env = { COMMENT_MEDIA_CDN_BASE: 'https://media.example.test' };
const comment = {
  id: 'c1',
  post_id: 'p1',
  parent_id: null,
  text: 'رأيته قرب الجسر',
  status: 'IMAGE_HIDDEN',
  author_id: 'u1',
  author_name: 'هنا إبراهيم',
  author_picture: 'https://cdn/a.png',
  post_title: 'Lost dog',
  created_at: '2026-11-13T10:00:00Z',
};

describe('buildCommentEvidence', () => {
  it('maps the text, author, Post and images with their public URLs', () => {
    const evidence = buildCommentEvidence(
      {
        comment,
        media: [
          { id: 'm1', storage_key: 'comments/c1/1.webp', width: 10, height: 20, file_content_type: 'image/webp' },
          { id: 'm2', storage_key: '', width: null, height: null },
        ],
      },
      env,
    );
    assert.equal(evidence.text, 'رأيته قرب الجسر');
    assert.equal(evidence.author.name, 'هنا إبراهيم');
    assert.deepEqual(evidence.post, { id: 'p1', title: 'Lost dog' });
    assert.equal(evidence.isReply, false);
    assert.equal(evidence.media[0].url, 'https://media.example.test/comments/c1/1.webp');
    assert.equal(evidence.media[1].available, false, 'a blank key is an unavailable image');
  });

  it('marks images hidden from users for an image-hidden or hidden Comment, but not an active one', () => {
    const media = [{ id: 'm1', storage_key: 'k.webp' }];
    const flags = (status) =>
      buildCommentEvidence({ comment: { ...comment, status }, media }, env).media[0].hiddenFromUsers;
    assert.equal(flags('IMAGE_HIDDEN'), true);
    assert.equal(flags('HIDDEN'), true);
    assert.equal(flags('ACTIVE'), false);
    const hiddenImages = buildCommentEvidence({ comment, media }, env);
    assert.equal(hiddenImages.imagesHidden, true);
    assert.equal(hiddenImages.statusLabel, 'Image hidden');
  });

  it('describes a Reply by its parent and keeps each report with its status', () => {
    const evidence = buildCommentEvidence(
      {
        comment: { ...comment, parent_id: 'c0', parent_text: 'x'.repeat(100), status: 'ACTIVE' },
        reports: [
          { id: 'r1', reason: 'SPAM', details: 'bad', reporter_id: 'u2', reporter_name: 'Nour', reviewed_at: null },
          { id: 'r2', reason: 'SPAM', reporter_id: null, reporter_name: null, reviewed_at: '2026-11-13T11:00:00Z' },
        ],
      },
      env,
      'r1',
    );
    assert.equal(evidence.isReply, true);
    assert.equal(evidence.parent.id, 'c0');
    assert.ok(evidence.parent.excerpt.length <= 60);
    assert.equal(evidence.currentReportId, 'r1');
    assert.equal(evidence.reports[0].statusLabel, 'Open');
    assert.equal(evidence.reports[0].isOpen, true);
    assert.equal(evidence.reports[1].statusLabel, 'Closed');
    assert.equal(evidence.reports[1].reporter.name, 'Deleted account', 'only a missing user is a deleted account');
  });
});

describe('loadCommentEvidence', () => {
  const pool = () => {
    const calls = [];
    return {
      calls,
      query: async (sql, [ids]) => {
        calls.push(sql);
        if (sql.includes('FROM comment_media'))
          return { rows: [{ id: 'm', comment_id: ids[0], storage_key: 'k.webp' }] };
        if (sql.includes('FROM comment_reports')) return { rows: [] };
        return { rows: ids.map((id) => ({ ...comment, id })) };
      },
    };
  };

  it('uses three queries however many Comments are asked for', async () => {
    const fake = pool();
    const result = await loadCommentEvidence(fake, ['c1', 'c2', 'c1', null], env);
    assert.equal(fake.calls.length, 3);
    assert.deepEqual([...result.keys()].sort(), ['c1', 'c2']);
    assert.equal(result.get('c1').media.length, 1);
  });

  it('does nothing for no ids', async () => {
    const fake = pool();
    assert.equal((await loadCommentEvidence(fake, [], env)).size, 0);
    assert.equal(fake.calls.length, 0);
  });

  it('stores the evidence on the shown record for a Comment Report, remembering which report it is', async () => {
    const hook = attachCommentEvidence(pool(), {
      commentIdOf: (params) => params.comment_id,
      reportIdOf: (params) => params.id,
    });
    const response = await hook({ record: { params: { id: 'r9', comment_id: 'c1' } } });
    assert.equal(JSON.parse(response.record.params.comment_evidence).currentReportId, 'r9');
  });
});
