'use client';

import { Typography } from 'antd';

/** Page title with an optional line under it. */
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 4 }}>
        {title}
      </Typography.Title>
      {subtitle === undefined ? null : (
        <Typography.Text type="secondary">{subtitle}</Typography.Text>
      )}
    </div>
  );
}
