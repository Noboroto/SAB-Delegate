'use client';

import type { ReactNode } from 'react';
import { Typography, theme } from 'antd';

/**
 * A title inside a page (the page's own title is `Heading`'s `h1`): level 2 for
 * a section or card title, level 3 for a block inside that card. Size and line
 * height come from the theme's heading scale, so every title of a level looks
 * the same on every page and no level is skipped.
 * `flush` drops the bottom margin, for a title that is a `Card`'s own `title`.
 */
export function SectionTitle({
  id,
  level = 2,
  flush = false,
  children,
}: {
  id?: string;
  level?: 2 | 3;
  flush?: boolean;
  children: ReactNode;
}) {
  const { token } = theme.useToken();
  const size = level === 2 ? token.fontSizeHeading2 : token.fontSizeHeading3;
  const lineHeight = level === 2 ? token.lineHeightHeading2 : token.lineHeightHeading3;

  return (
    <Typography.Title
      level={level}
      id={id}
      style={{
        marginTop: 0,
        ...(flush ? { marginBottom: 0 } : {}),
        fontSize: size,
        lineHeight,
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </Typography.Title>
  );
}
