'use client';

import { Typography, theme } from 'antd';

/**
 * The title of a page, and the page's only `h1`, with an optional line under
 * it. Its size is the theme's h1 token, larger than a `SectionTitle` (h2), so
 * the page title outranks the card titles under it.
 */
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { token } = theme.useToken();

  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <Typography.Title
        level={1}
        style={{
          marginTop: 0,
          marginBottom: 'var(--space-1)',
          fontSize: token.fontSizeHeading1,
          lineHeight: token.lineHeightHeading1,
          overflowWrap: 'anywhere',
        }}
      >
        {title}
      </Typography.Title>
      {subtitle === undefined ? null : (
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      )}
    </div>
  );
}
