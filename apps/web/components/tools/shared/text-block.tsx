'use client';

import { theme } from 'antd';
import { CopyButton } from './copy-button';

interface TextBlockProps {
  text: string;
  /** Names the copy button; a page with several blocks needs a different name on each. */
  copyLabel?: string;
  /** What the button copies when that differs from what is shown (ids behind a list of names). */
  copyText?: string;
}

/** Text the service returned, shown as written (plain text, never markup) with a button to copy it. */
export function TextBlock({ text, copyLabel, copyText }: TextBlockProps) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'start' }}>
      <div
        style={{
          width: '100%',
          maxHeight: '15rem',
          overflow: 'auto',
          padding: 'var(--space-2) var(--space-3)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadius,
          fontFamily: token.fontFamilyCode,
        }}
      >
        {text}
      </div>
      <CopyButton text={copyText ?? text} label={copyLabel} />
    </div>
  );
}
