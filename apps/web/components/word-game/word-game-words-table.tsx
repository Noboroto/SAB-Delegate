'use client';

import { useTransition } from 'react';
import { Card, Select, Table } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { WordGameWordsPage, WordGameWordsQuery } from '@sab/shared';
import { wordsQueryString } from '@/lib/word-game/words-query';

type SortKey = 'played:asc' | 'played:desc' | 'word:asc' | 'word:desc';

const SORTS: Record<SortKey, Pick<WordGameWordsQuery, 'sort' | 'order'>> = {
  'played:asc': { sort: 'played', order: 'asc' },
  'played:desc': { sort: 'played', order: 'desc' },
  'word:asc': { sort: 'word', order: 'asc' },
  'word:desc': { sort: 'word', order: 'desc' },
};

/** The words used this round. Paging and order live in the URL and are answered by the server, one page at a time. */
export function WordGameWordsTable({
  words,
  query,
}: {
  words: WordGameWordsPage;
  query: WordGameWordsQuery;
}) {
  const t = useTranslations('web-word-game');
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const { page, pageSize, total } = words.pagination;
  const offset = (page - 1) * pageSize;

  const go = (next: WordGameWordsQuery) =>
    startNavigation(() => router.push(`${pathname}?${wordsQueryString(next)}`));

  const sortLabels: Record<SortKey, string> = {
    'played:asc': t('words.sortPlayedAsc'),
    'played:desc': t('words.sortPlayedDesc'),
    'word:asc': t('words.sortWordAsc'),
    'word:desc': t('words.sortWordDesc'),
  };

  return (
    <Card
      title={t('words.title', { count: total })}
      extra={
        <Select<SortKey>
          aria-label={t('words.sort')}
          value={`${query.sort}:${query.order}`}
          options={(Object.keys(SORTS) as SortKey[]).map((key) => ({
            value: key,
            label: sortLabels[key],
          }))}
          onChange={(key) => go({ ...query, ...SORTS[key], page: 1 })}
          style={{ minWidth: 'var(--w-xs)' }}
        />
      }
    >
      <Table<{ word: string }>
        rowKey="word"
        loading={navigating}
        dataSource={words.items}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('words.empty') }}
        columns={[
          ...(query.sort === 'played'
            ? [
                {
                  key: 'position',
                  title: t('words.position'),
                  width: 'var(--w-2xs)',
                  render: (_: unknown, __: unknown, index: number) =>
                    query.order === 'asc' ? offset + index + 1 : total - offset - index,
                },
              ]
            : []),
          { key: 'word', title: t('words.word'), dataIndex: 'word' },
        ]}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          onChange: (next) => go({ ...query, page: next }),
        }}
      />
    </Card>
  );
}
