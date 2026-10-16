'use client';

import { App, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ChatbotTurnDeleteTargetSchema, z } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { deleteChatbotTurns } from '@/lib/chatbot/chatbot-api';

/** Deletes logged exchanges after the service has counted what would go. */
export function ChatbotTurnDelete({
  guildId,
  target,
  label,
  onDone,
}: {
  guildId: string;
  target: z.infer<typeof ChatbotTurnDeleteTargetSchema>;
  /** Names the scope ("Delete all exchanges"), not just "Delete". */
  label: string;
  onDone?: () => void;
}) {
  const t = useTranslations('web-chatbot');
  const { message } = App.useApp();
  const router = useRouter();

  return (
    <ConfirmAction
      label={label}
      modalTitle={t('history.delete.title')}
      confirmLabel={t('history.delete.confirm')}
      preview={() => deleteChatbotTurns(guildId, target, true)}
      execute={() => deleteChatbotTurns(guildId, target, false)}
      canConfirm={(plan) => plan.count > 0}
      renderPlan={(plan) => (
        <Typography.Paragraph>
          {plan.count === 0
            ? t('history.delete.nothing')
            : t('history.delete.plan', { count: plan.count })}
        </Typography.Paragraph>
      )}
      onDone={(result) => {
        void message.success(t('history.delete.done', { count: result.count }));
        onDone?.();
        router.refresh();
      }}
    />
  );
}
