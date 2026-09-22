import { COMPLETED_POST_OUTCOMES } from '../../../src/common/contracts/post-lifecycle.contract.ts';

export const LOST_SUBTYPE_VALUES = Object.freeze(['LOST_PET', 'FOUND_STRAY']);
export const REPORT_REVIEW_STATE_VALUES = Object.freeze(['OPEN', 'REVIEWED']);
// Derived from the shared lifecycle contract so the completed-history queue and
// the API's reopening rule cannot drift from the one outcome list.
export const COMPLETED_POST_STATUSES = Object.freeze([...COMPLETED_POST_OUTCOMES]);
