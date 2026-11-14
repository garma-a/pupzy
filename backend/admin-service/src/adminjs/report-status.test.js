import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reportReviewStatus } from './report-status.js';

describe('reportReviewStatus', () => {
  it('reads Open until the report has been reviewed', () => {
    assert.deepEqual(reportReviewStatus({ reviewedAt: null, reviewOutcome: null }), {
      state: 'OPEN',
      label: 'Open',
      isOpen: true,
    });
    assert.equal(reportReviewStatus({}).label, 'Open');
    assert.equal(reportReviewStatus().label, 'Open');
    assert.equal(reportReviewStatus({ reviewedAt: '' }).isOpen, true);
  });

  it('names the outcome of a closed report in plain words', () => {
    const reviewedAt = '2026-11-13T04:15:34Z';
    assert.equal(reportReviewStatus({ reviewedAt, reviewOutcome: 'NO_ACTION' }).label, 'Closed: no action');
    assert.equal(reportReviewStatus({ reviewedAt, reviewOutcome: 'ACTION_TAKEN' }).label, 'Closed: action taken');
    assert.equal(reportReviewStatus({ reviewedAt, reviewOutcome: 'NO_ACTION' }).isOpen, false);
  });

  it('shows just Closed when a closed report has no outcome (Comment Reports)', () => {
    assert.deepEqual(reportReviewStatus({ reviewedAt: '2026-11-13T04:15:34Z', reviewOutcome: null }), {
      state: 'CLOSED',
      label: 'Closed',
      isOpen: false,
    });
  });
});
