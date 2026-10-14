'use client';

import { App, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { WordGameResetResult } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { resetWordGame } from '@/lib/word-game/word-game-api';
import { WordSample } from './word-sample';

/** Starts the round over. The words that would be cleared are counted by the service before anything is. */
export function WordGameReset({ guildId }: { guildId: string }) {
  const t = useTranslations('web-word-game');
  const { message } = App.useApp();
  const router = useRouter();

  return (
    <ConfirmAction
      label={t('reset.action')}
      modalTitle={t('reset.modalTitle')}
      confirmLabel={t('reset.confirm')}
      preview={() => resetWordGame(guildId, true)}
      execute={() => resetWordGame(guildId, false)}
      canConfirm={(plan) => plan.status === 'RESET'}
      renderPlan={(plan: WordGameResetResult) =>
        plan.status === 'NOT_CONFIGURED' ? (
          <Typography.Paragraph>{t('reset.notConfigured')}</Typography.Paragraph>
        ) : (
          <>
            <Typography.Paragraph>
              {t('reset.plan', { count: plan.clearedWords })}
            </Typography.Paragraph>
            <WordSample words={plan.sample} />
          </>
        )
      }
      onDone={(result) => {
        void message.success(t('reset.done', { count: result.clearedWords }));
        router.refresh();
      }}
    />
  );
}
