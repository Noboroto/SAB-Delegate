'use client';

import { Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { BotProfileSetResultSchema, type BotProfileSetResult } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

interface RestoreAvatarActionProps {
  guildId: string;
  disabled: boolean;
  onDone: () => void;
}

/** Drops the server picture so the bot's own shows again; the service previews it first because the old picture cannot be brought back. */
export function RestoreAvatarAction({ guildId, disabled, onDone }: RestoreAvatarActionProps) {
  const t = useTranslations('web-settings.botProfile');

  const call = (dryRun: boolean): Promise<BotProfileSetResult> =>
    apiFetch(guildApiPath(guildId, 'bot-profile'), {
      method: 'PATCH',
      body: { avatar: null, dryRun },
      parser: BotProfileSetResultSchema,
    });

  return (
    <ConfirmAction
      label={t('restoreAvatar')}
      modalTitle={t('restoreAvatar')}
      confirmLabel={t('restoreAvatarConfirmOk')}
      disabled={disabled}
      preview={() => call(true)}
      execute={() => call(false)}
      renderPlan={() => <Typography.Paragraph>{t('restoreAvatarConfirm')}</Typography.Paragraph>}
      onDone={onDone}
    />
  );
}
