'use client';

import { Alert, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { useChannels } from '@/lib/discord/use-channels';
import { useRoles } from '@/lib/discord/use-roles';
import { QuotedText } from '../shared/quoted-text';

/**
 * What a private-thread run will do, worked out from the form: the service has
 * no preview for it, so this lists what the request says (where, named how,
 * for whom, with which first message), never an outcome.
 */
export type PrivateThreadPlan = {
  channelId: string;
  prefix: string;
  message: string;
  /** Members known now (pasted ids, or who reacted); `undefined` when the role alone decides. */
  memberCount: number | undefined;
  roleId: string | undefined;
  /** Set when the members are the ones who reacted. */
  emoji: string | undefined;
};

export function PrivateThreadPlanView({
  guildId,
  plan,
}: {
  guildId: string;
  plan: PrivateThreadPlan;
}) {
  const t = useTranslations('web-tools');
  const channels = useChannels(guildId);
  const roles = useRoles(guildId);
  const channel = channels.data?.find((item) => item.id === plan.channelId)?.name ?? plan.channelId;
  const role =
    plan.roleId === undefined
      ? undefined
      : (roles.data?.find((item) => item.id === plan.roleId)?.name ?? plan.roleId);

  const listed = plan.memberCount ?? 0;
  const reactorsUncounted = plan.emoji !== undefined && plan.memberCount === undefined;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {reactorsUncounted ? (
        <Typography.Text strong>
          {t('threads.private.planReactorsUncounted', {
            emoji: plan.emoji ?? '',
            channel,
            prefix: plan.prefix,
          })}
        </Typography.Text>
      ) : null}
      {listed === 0 && role === undefined && !reactorsUncounted ? (
        <Alert type="info" showIcon title={t('threads.private.planNobody')} />
      ) : null}
      {listed === 0 ? null : (
        <Typography.Text strong>
          {plan.emoji === undefined
            ? t('threads.private.planMembers', { count: listed, channel, prefix: plan.prefix })
            : t('threads.private.planReactors', {
                count: listed,
                emoji: plan.emoji,
                channel,
                prefix: plan.prefix,
              })}
        </Typography.Text>
      )}
      {role === undefined ? null : (
        <Typography.Text>{t('threads.private.planRole', { role })}</Typography.Text>
      )}
      <Typography.Text type="secondary">{t('threads.private.planMessage')}</Typography.Text>
      <QuotedText text={plan.message} />
    </div>
  );
}
