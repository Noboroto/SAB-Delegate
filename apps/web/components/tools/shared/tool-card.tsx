'use client';

import type { ReactNode } from 'react';
import { Card, Typography } from 'antd';

interface ToolCardProps {
  /** Left out when the page heading already says it (a tool with one card, or a tab named the same). */
  title?: string;
  description?: string;
  children: ReactNode;
}

/** One action of a tool: what it does, then its form and (below it) its answer. */
export function ToolCard({ title, description, children }: ToolCardProps) {
  return (
    <Card title={title}>
      {description === undefined ? null : (
        <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
      )}
      {children}
    </Card>
  );
}
