'use client';

import { Descriptions, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { ActivityCreate } from '@sab/shared';
import { useChannels } from '@/lib/discord/use-channels';

/**
 * The roles and channels a run will create, named the way the service names
 * them (role `name-Suffix`; text channels the lower-cased `emoji┃name` with
 * spaces as dashes; the voice channel `emoji┃name voice`). The service has no
 * preview for this call, so the plan is worked out from the form.
 */
export function planActivity(request: ActivityCreate) {
  const { emoji, name } = request;
  const base = `${emoji}┃${name}`.toLowerCase().replaceAll(' ', '-');
  return {
    roles: [`${name}-Event`, `${name}-Multi`, `${name}-MC`],
    channels: [`${base}-general`, `${base}-thread-only`, `${emoji}┃${name} voice`],
    categoryId: request.categoryId,
  };
}

export type ActivityPlan = ReturnType<typeof planActivity>;

export function ActivityPlanView({ guildId, plan }: { guildId: string; plan: ActivityPlan }) {
  const t = useTranslations('web-tools');
  const channels = useChannels(guildId);
  const category =
    plan.categoryId === undefined
      ? t('activity.planDefaultCategory')
      : (channels.data?.find((channel) => channel.id === plan.categoryId)?.name ?? plan.categoryId);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Typography.Text>{t('activity.planIntro')}</Typography.Text>
      <Descriptions
        bordered
        size="small"
        column={1}
        items={[
          {
            key: 'roles',
            label: t('activity.planRoles'),
            children: <NameLines names={plan.roles} />,
          },
          {
            key: 'channels',
            label: t('activity.planChannels'),
            children: <NameLines names={plan.channels} />,
          },
          { key: 'category', label: t('activity.categoryLabel'), children: category },
        ]}
      />
    </div>
  );
}

function NameLines({ names }: { names: readonly string[] }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', overflowWrap: 'anywhere' }}>
      {names.map((name) => (
        <span key={name}>{name}</span>
      ))}
    </div>
  );
}
