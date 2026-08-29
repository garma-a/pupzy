import React, { useState } from 'react';
import { Box, Button } from '@adminjs/design-system';
import { formatShortUuid } from './short-uuid.js';

export { formatShortUuid };

export default function ShortUuid({ property, record, where }) {
  const value = record?.params?.[property?.path];
  const [copied, setCopied] = useState(false);

  if (value === undefined || value === null || value === '') {
    return <span style={{ color: '#B8A499' }}>—</span>;
  }

  const strValue = String(value);
  const isList = where === 'list';
  const displayValue = formatShortUuid(strValue, isList);

  const handleCopy = (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(strValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      className="pupzy-nowrap pupzy-uuid"
      style={{
        whiteSpace: 'nowrap',
        gap: '6px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: isList ? '12px' : '13px',
      }}
      title={strValue}
    >
      <span style={{ userSelect: 'all', color: '#2D1506' }}>{displayValue}</span>
      <Button
        size="icon"
        variant="light"
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied full UUID to clipboard' : `Copy full UUID (${strValue})`}
        title={copied ? 'Copied full UUID to clipboard!' : `Copy full UUID (${strValue})`}
        style={{
          padding: '2px 5px',
          height: isList ? '22px' : '24px',
          minWidth: isList ? '22px' : '24px',
          fontSize: '11px',
          lineHeight: '1',
          cursor: 'pointer',
          borderRadius: '4px',
          border: '1px solid #E8DED5',
          background: copied ? '#E7F3EF' : '#FFFFFF',
          color: copied ? '#2D8B6F' : '#8B6355',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {copied ? '✓' : '⧉'}
      </Button>
    </Box>
  );
}
