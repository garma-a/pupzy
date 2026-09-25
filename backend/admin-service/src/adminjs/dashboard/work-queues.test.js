import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  WORK_QUEUES,
  WORK_QUEUE_GROUPS,
  buildWorkQueueCountSql,
  loadWorkQueueCounts,
  queueHref,
} from './work-queues.js';

function queue(id) {
  return WORK_QUEUES.find((candidate) => candidate.id === id);
}

describe('Admin work-queue definitions', () => {
  it('declares unique queues for every agreed navigation entry', () => {
    assert.deepEqual(
      WORK_QUEUE_GROUPS.map((group) => group.id),
      ['needs_review', 'rescue', 'lost_found', 'listings', 'history'],
    );
    const ids = WORK_QUEUES.map((candidate) => candidate.id);
    assert.equal(new Set(ids).size, ids.length, 'queue ids must be unique');
    for (const id of [
      'flagged',
      'pending_moderation',
      'open_post_reports',
      'open_comment_reports',
      'open_account_reports',
      'rescue',
      'lost_found',
      'lost_pet',
      'found_stray',
      'adoption',
      'products',
      'mating',
      'completed',
      'expired',
      'removed',
    ]) {
      assert.ok(queue(id), `missing queue ${id}`);
    }
  });

  it('keeps moderation flags, pending moderation and open Reports distinct', () => {
    assert.deepEqual(queue('flagged').filters, { moderation_status: 'FLAGGED', status: 'ACTIVE' });
    assert.equal(queue('flagged').predicate, `moderation_status = 'FLAGGED' AND status = 'ACTIVE'`);
    assert.deepEqual(queue('pending_moderation').filters, {
      moderation_status: 'PENDING_AUTO_REVIEW',
      status: 'ACTIVE',
    });
    for (const id of ['open_post_reports', 'open_comment_reports', 'open_account_reports']) {
      assert.deepEqual(queue(id).filters, { review_state: 'OPEN' });
      assert.equal(queue(id).predicate, 'reviewed_at IS NULL');
      assert.notEqual(queue(id).resource, 'posts');
    }
  });

  it('uses the existing type, lifecycle and subtype filters for the work queues', () => {
    assert.deepEqual(queue('rescue').filters, { post_type: 'RESCUE', status: 'ACTIVE' });
    assert.deepEqual(queue('lost_found').filters, { post_type: 'LOST', status: 'ACTIVE' });
    assert.deepEqual(queue('lost_pet').filters, {
      post_type: 'LOST',
      status: 'ACTIVE',
      report_type: 'LOST_PET',
    });
    assert.deepEqual(queue('found_stray').filters, {
      post_type: 'LOST',
      status: 'ACTIVE',
      report_type: 'FOUND_STRAY',
    });
    assert.match(queue('lost_pet').predicate, /lost_posts WHERE report_type = 'LOST_PET'/);
    assert.match(queue('found_stray').predicate, /lost_posts WHERE report_type = 'FOUND_STRAY'/);
    for (const id of ['adoption', 'products', 'mating']) {
      assert.equal(queue(id).filters.status, 'ACTIVE');
    }
  });

  it('keeps completed, expired and removed history views distinct', () => {
    assert.deepEqual(queue('completed').filters, { queue: 'completed' });
    assert.equal(
      queue('completed').predicate,
      `status IN ('RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD', 'ANIMAL_DECEASED')`,
    );
    assert.deepEqual(queue('expired').filters, { status: 'EXPIRED' });
    assert.deepEqual(queue('removed').filters, { status: 'REMOVED' });
  });

  it('builds a count query whose predicates match the list filters', () => {
    const sql = buildWorkQueueCountSql();
    for (const candidate of WORK_QUEUES) {
      assert.match(sql, new RegExp(`AS "${candidate.id}"`));
      assert.ok(sql.includes(`FROM ${candidate.resource} WHERE ${candidate.predicate}`));
    }
  });

  it('maps count rows onto queue counts', async () => {
    const pool = {
      async query() {
        return { rows: [{ flagged: '3', lost_pet: '2' }] };
      },
    };
    const counts = await loadWorkQueueCounts(pool);
    assert.equal(counts.flagged, '3');
    assert.equal(counts.lost_pet, '2');
  });

  it('builds filter-preserving AdminJS list links', () => {
    assert.equal(
      queueHref(queue('flagged'), '/admin'),
      '/admin/resources/posts?filters.moderation_status=FLAGGED&filters.status=ACTIVE',
    );
    assert.equal(
      queueHref(queue('lost_pet'), '/admin'),
      '/admin/resources/posts?filters.post_type=LOST&filters.status=ACTIVE&filters.report_type=LOST_PET',
    );
    assert.equal(
      queueHref(queue('open_post_reports'), '/admin'),
      '/admin/resources/post_reports?filters.review_state=OPEN',
    );
    assert.equal(queueHref(queue('expired')), '/admin/resources/posts?filters.status=EXPIRED');
  });
});
