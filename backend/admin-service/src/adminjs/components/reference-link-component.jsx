import React, { useState } from 'react';
import { ViewHelpers, useTranslation } from 'adminjs';
import { useNavigate } from 'react-router';

import { deletedLabel, referenceTitle } from '../reference-title.js';
import { formatShortUuid } from './short-uuid.js';
import { Avatar } from './avatar-component.jsx';

const helpers = new ViewHelpers();
const MUTED = { color: '#B8A499' };

function CopyId({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied ID to clipboard' : `Copy ID (${value})`}
      title={copied ? 'Copied ID' : `Copy ID (${value})`}
      style={{
        border: '1px solid #E8DED5',
        background: '#FFFFFF',
        color: copied ? '#2D8B6F' : '#8B6355',
        borderRadius: 4,
        fontSize: 11,
        lineHeight: 1,
        padding: '2px 5px',
        cursor: 'pointer',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

/**
 * A foreign key shown as the referenced record's readable name, linked to its
 * page. Works for real references (AdminJS puts the target in
 * `record.populated`) and polymorphic ones (`reference-targets.js` does the
 * same). Show pages keep a small copy-ID button; lists never print a raw UUID.
 */
export default function ReferenceLink(props) {
  const { property, where } = props;
  const { translateProperty } = useTranslation();
  const body = <ReferenceValue {...props} />;
  if (where !== 'show') return body;
  // Show pages print the property label because a custom component replaces AdminJS's own row.
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
        {translateProperty(property?.path, property?.resourceId)}
      </div>
      {body}
    </div>
  );
}

function ReferenceValue({ property, record, where }) {
  const navigate = useNavigate();
  const value = record?.params?.[property?.path];
  if (value === undefined || value === null || value === '') return <span style={MUTED}>—</span>;

  const id = String(value);
  const isShow = where === 'show';
  const populated = record?.populated?.[property.path];
  const resourceId = populated && 'resourceId' in populated ? populated.resourceId : property.reference;
  const copy = isShow ? <CopyId value={id} /> : null;
  const wrap = { display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' };

  if (!resourceId) {
    return (
      <span style={wrap} title={id}>
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{formatShortUuid(id, true)}</span>
        {copy}
      </span>
    );
  }

  if (!populated || populated.missing) {
    return (
      <span style={wrap} data-testid="pupzy-reference-deleted">
        <span style={MUTED}>{deletedLabel(resourceId)}</span>
        {copy}
      </span>
    );
  }

  const title = referenceTitle(resourceId, populated.params, id, populated.title);
  const href = helpers.recordActionUrl({ resourceId, recordId: id, actionName: 'show' });
  const onClick = (event) => {
    // Never let the list row navigate; a plain click moves within the admin app.
    event.stopPropagation();
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      navigate(href);
    }
  };

  return (
    <span style={wrap}>
      <a
        href={href}
        onClick={onClick}
        data-testid="pupzy-reference-link"
        data-reference-resource={resourceId}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          color: '#C4622D',
          textDecoration: 'none',
        }}
      >
        {resourceId === 'users' ? <Avatar name={title} src={populated.params?.profile_picture_url} size={22} /> : null}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
          {title}
        </span>
      </a>
      {copy}
    </span>
  );
}
