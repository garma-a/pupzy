import React from 'react';
import { referenceTitle, deletedLabel } from '../reference-title.js';
import { auditSentence } from '../review/audit-sentence.js';
export default function AuditActivity({ record }) {
  const params = record.params,
    actor = record.populated?.admin_user_id,
    target = record.populated?.target_id;
  const targetTitle =
    !target || target.missing
      ? deletedLabel(target?.resourceId)
      : referenceTitle(target?.resourceId, target?.params, params.target_id, target?.title);
  let metadata = params.metadata ?? { outcome: params['metadata.outcome'] };
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  const sentence = auditSentence({
    actor: actor?.params?.full_name?.trim() || actor?.params?.email || actor?.title,
    action: params.action_type,
    target: targetTitle,
    reason: params.reason,
    metadata,
  });
  return (
    <span className="pupzy-audit-sentence" dir="auto" title={sentence}>
      {sentence}
    </span>
  );
}
