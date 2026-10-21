'use client';

import { Tag } from 'antd';
import { useTranslations } from 'next-intl';

/** A few of the words a change would clear, as plain text, so the person can recognise the round. */
export function WordSample({ words }: { words: readonly string[] }) {
  const t = useTranslations('web-word-game');
  if (words.length === 0) return null;

  return (
    <div
      aria-label={t('sample')}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}
    >
      {words.map((word) => (
        <Tag key={word} style={{ marginInlineEnd: 0 }}>
          {word}
        </Tag>
      ))}
    </div>
  );
}
