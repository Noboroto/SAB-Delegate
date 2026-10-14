'use client';

import { theme } from 'antd';
import { CopyButton } from './copy-button';

interface TextBlockProps {
  text: string;
  /** Names the copy button when a page shows several blocks. */
  copyLabel?: string;
  /** What the button copies when that differs from what is shown (ids behind a list of names). */
  copyText?: string;
}

/** Text the service returned, shown as written (plain text, never markup) with a button to copy it. */
export function TextBlock({ text, copyLabel, copyText }: TextBlockProps) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <div
        style={{
          width: '100%',
          maxHeight: 240,
          overflow: 'auto',
          padding: '8px 12px',
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
