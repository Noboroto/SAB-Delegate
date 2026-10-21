'use client';

import { Card, Skeleton, Spin } from 'antd';
import { useTranslations } from 'next-intl';

interface PageLoadingProps {
  /**
   * The shape of what is loading: a form column, a table, or a grid of cards.
   * Omitted: a centred spinner, for a page with no fixed shape.
   */
  variant?: 'form' | 'table' | 'cards';
}

const ROWS = 5;
const CARDS = 3;

function Shape({ variant }: { variant: NonNullable<PageLoadingProps['variant']> }) {
  switch (variant) {
    case 'form':
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            width: '100%',
            maxWidth: 'var(--form-w)',
          }}
        >
          <Skeleton.Input active style={{ width: '40%' }} />
          {[0, 1, 2].map((field) => (
            <div key={field}>
              <Skeleton.Input active size="small" style={{ width: '30%' }} />
              <Skeleton.Input active block style={{ marginTop: 'var(--space-1)' }} />
            </div>
          ))}
          <Skeleton.Button active />
        </div>
      );
    case 'table':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Skeleton.Input active style={{ width: '40%' }} />
          <Skeleton active title={false} paragraph={{ rows: ROWS, width: '100%' }} />
        </div>
      );
    case 'cards':
      return (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-4)',
            gridTemplateColumns: 'repeat(auto-fill, minmax(var(--w-sm), 1fr))',
          }}
        >
          {Array.from({ length: CARDS }, (_, card) => (
            <Card key={card}>
              <Skeleton active paragraph={{ rows: 2 }} />
            </Card>
          ))}
        </div>
      );
  }
}

/**
 * What a page shows while its data loads, announced to screen readers. A
 * `variant` draws a skeleton of the page's shape so nothing jumps when the data
 * arrives; without one it is a centred spinner.
 */
export function PageLoading({ variant }: PageLoadingProps) {
  const t = useTranslations('web');

  return (
    <div
      role="status"
      aria-label={t('loading')}
      style={
        variant === undefined
          ? { display: 'grid', placeItems: 'center', minHeight: 'var(--w-sm)' }
          : undefined
      }
    >
      {variant === undefined ? <Spin size="large" /> : <Shape variant={variant} />}
    </div>
  );
}
