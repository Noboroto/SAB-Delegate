'use client';

import { Typography, theme } from 'antd';

/**
 * The title of a page, and the page's only `h1`, with an optional line under
 * it. The size is that of a second-level title so the pages keep one look.
 */
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { token } = theme.useToken();

  return (
    <div style={{ marginBottom: 24 }}>
      <Typography.Title
        level={1}
        style={{
          marginTop: 0,
          marginBottom: 4,
          fontSize: token.fontSizeHeading2,
          lineHeight: token.lineHeightHeading2,
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
