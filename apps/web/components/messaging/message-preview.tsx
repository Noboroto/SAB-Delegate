'use client';

import { theme } from 'antd';

/**
 * Message text exactly as the service returned it. It is text, never markup:
 * what a person typed (or what is in someone else's message) must not be able
 * to draw anything on the dashboard.
 */
export function MessagePreview({ content }: { content: string }) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        padding: token.paddingSM,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
        maxHeight: 'calc(var(--space-6) * 10)',
        overflowY: 'auto',
      }}
    >
      {content}
    </div>
  );
}
