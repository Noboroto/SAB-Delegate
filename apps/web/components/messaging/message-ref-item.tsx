'use client';

import { Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import type { MessageRefFailure } from '@sab/shared';

interface MessageRefItemProps {
  name: string;
  label: string;
  /** What is wrong with the text typed so far; `undefined` while it is empty or fine. */
  problem: MessageRefFailure | undefined;
}

/** A message named by pasting its link; the hint says where to get one. */
export function MessageRefItem({ name, label, problem }: MessageRefItemProps) {
  const t = useTranslations('web-messaging');
  const problems: Record<MessageRefFailure, string> = {
    EMPTY: t('ref.problem.malformed'),
    MALFORMED: t('ref.problem.malformed'),
    CHANNEL_REQUIRED: t('ref.problem.channelRequired'),
  };

  return (
    <Form.Item
      name={name}
      label={label}
      extra={t('ref.hint')}
      validateStatus={problem === undefined ? undefined : 'error'}
      help={problem === undefined ? undefined : problems[problem]}
    >
      <Input autoComplete="off" />
    </Form.Item>
  );
}
