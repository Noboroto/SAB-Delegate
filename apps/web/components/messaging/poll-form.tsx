'use client';

import { App, Descriptions, Form, InputNumber, Segmented, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { POLL_CHOICES_MAX, type CreateReactionPollResult } from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { useUnsavedChanges } from '@/components/forms/unsaved-guard';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { createReactionPoll } from '@/lib/messaging/messaging-api';
import { useFormValues } from '@/lib/messaging/use-form-values';
import { buildPoll, refProblem, requireBuilt, type PollTarget } from '@/lib/messaging/requests';
import { ChannelLabel } from './channel-label';
import { MessageRefItem } from './message-ref-item';

interface Values {
  mode: PollTarget;
  channelId?: string;
  message?: string;
  choices?: number | null;
}

/** A poll is the numbered reactions on a message: a new one, or one that already exists. */
export function PollForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-messaging');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const values: Values = { mode: 'new', ...useFormValues(form) };
  // Only what the person chose counts: the default mode and choice count are not unsaved work.
  useUnsavedChanges((values.message ?? '').trim() !== '' || (values.channelId ?? '') !== '');
  const request = buildPoll(values);

  return (
    <Form form={form} layout="vertical" initialValues={{ mode: 'new', choices: 2 }}>
      <Form.Item name="mode" label={t('poll.mode')}>
        <Segmented<PollTarget>
          options={[
            { value: 'new', label: t('poll.modeNew') },
            { value: 'existing', label: t('poll.modeExisting') },
          ]}
        />
      </Form.Item>
      {values.mode === 'new' ? (
        <Form.Item name="channelId" label={t('fields.channel')}>
          <ChannelSelect guildId={guildId} types={TEXT_CHANNEL_TYPES} />
        </Form.Item>
      ) : (
        <MessageRefItem
          name="message"
          label={t('poll.message')}
          problem={refProblem(values.message)}
        />
      )}
      <Form.Item name="choices" label={t('poll.choices')}>
        <InputNumber min={1} max={POLL_CHOICES_MAX} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0 }}>
        <ConfirmAction
          danger={false}
          label={t('poll.action')}
          modalTitle={t('poll.modalTitle')}
          confirmLabel={t('poll.confirm')}
          disabled={!request.ok}
          preview={() => createReactionPoll(guildId, requireBuilt(request), true)}
          execute={() => createReactionPoll(guildId, requireBuilt(request), false)}
          renderPlan={(plan: CreateReactionPollResult) => (
            <>
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'channel',
                    label: t('fields.channel'),
                    children: <ChannelLabel guildId={guildId} channelId={plan.channelId} />,
                  },
                  {
                    key: 'target',
                    label: t('poll.mode'),
                    children: plan.created ? t('poll.planNew') : t('poll.planExisting'),
                  },
                ]}
              />
              <Typography.Text>
                {t('poll.planEmojis', { count: plan.emojis.length })}
              </Typography.Text>
              <div style={{ fontSize: '1.5em', overflowWrap: 'anywhere' }}>
                {plan.emojis.join(' ')}
              </div>
            </>
          )}
          onDone={() => {
            void message.success(t('poll.done'));
            form.resetFields();
            router.refresh();
          }}
        />
      </Form.Item>
    </Form>
  );
}
