'use client';

import { theme } from 'antd';

/** A message exactly as it will be posted, set off from the text around it. */
export function QuotedText({ text }: { text: string }) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        borderInlineStart: `2px solid ${token.colorBorder}`,
        paddingInlineStart: 'var(--space-3)',
      }}
    >
      {text}
    </div>
  );
}
