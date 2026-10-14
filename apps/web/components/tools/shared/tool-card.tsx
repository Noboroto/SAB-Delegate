'use client';

import type { ReactNode } from 'react';
import { Card, Typography } from 'antd';

interface ToolCardProps {
  title: string;
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
