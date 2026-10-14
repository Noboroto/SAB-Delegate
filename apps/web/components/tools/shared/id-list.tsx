'use client';

import { Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { TextBlock } from './text-block';

interface IdListProps {
  title: string;
  ids: readonly string[];
}

/** A list of Discord ids, one per line so it can be pasted into another tool as it is. */
export function IdList({ title, ids }: IdListProps) {
  const t = useTranslations('web-tools');

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Typography.Text strong>
        {t('common.idListTitle', { title, count: ids.length })}
      </Typography.Text>
      {ids.length === 0 ? (
        <Typography.Text type="secondary">{t('common.none')}</Typography.Text>
      ) : (
        <TextBlock text={ids.join('\n')} />
      )}
    </div>
  );
}
