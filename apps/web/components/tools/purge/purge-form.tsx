'use client';

import { useRef } from 'react';
import { Form, Input, InputNumber, Segmented } from 'antd';
import { useTranslations } from 'next-intl';
import {
  PURGE_COUNT_MAX,
  PurgePlanSchema,
  PurgeRequestSchema,
  PurgeResultSchema,
  type PurgeResult,
} from '@sab/shared';
import { ResultBlock } from '@/components/ui/result-block';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { CHANNEL_TYPE } from '@/lib/discord/use-channels';
import { blankToUndefined, buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { ValidatedAction } from '../shared/validated-action';
import { PurgeOutcome, PurgePlanView } from './purge-views';

interface Values {
  mode?: 'last' | 'range';
  channelId?: string;
  count?: number;
  until?: string;
  from?: string;
}

/** Channels with a message history; a category has none. */
const PURGE_CHANNEL_TYPES: readonly number[] = [
  CHANNEL_TYPE.text,
  CHANNEL_TYPE.announcement,
  CHANNEL_TYPE.voice,
  CHANNEL_TYPE.stage,
];

interface Flags {
  dryRun: boolean;
  confirm: boolean;
}

/** The id of a message that must lie in the chosen channel; a link into another channel is not one. */
function messageIdIn(text: string | undefined, channelId: string | undefined): string | undefined {
  const ref = readMessageRef(text, channelId ?? null);
  return ref !== undefined && (channelId === undefined || ref.channelId === channelId)
    ? ref.messageId
    : undefined;
}

/**
 * Deletes the newest messages of a channel, or every message between two. The
 * service's `dryRun` plan is what the person confirms, and the real call is
 * pinned to that plan's newest message so messages posted in between are not
 * swept in.
 */
export function PurgeForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const done = useWriteDone();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const plannedFrom = useRef<string | null>(null);
  const range = values.mode === 'range';

  const messageRule = {
    validator: (_rule: unknown, value: string | undefined) =>
      blankToUndefined(value) === undefined || messageIdIn(value, values.channelId) !== undefined
        ? Promise.resolve()
        : Promise.reject(new Error(t('purge.messageInvalid'))),
  };

  const build = (flags: Flags, pinnedFrom: string | null) => {
    // `from` belongs to the range form; a value left in it after switching mode must not count.
    const typedFrom = range ? values.from : undefined;
    const typedId = messageIdIn(typedFrom, values.channelId);
    if (blankToUndefined(typedFrom) !== undefined && typedId === undefined) return undefined;
    const from = pinnedFrom ?? typedId;
    if (range) {
      return buildRequest(PurgeRequestSchema, {
        mode: 'range',
        channelId: values.channelId,
        untilMessageId: messageIdIn(values.until, values.channelId),
        fromMessageId: from,
        ...flags,
      });
    }
    return buildRequest(PurgeRequestSchema, {
      mode: 'last',
      channelId: values.channelId,
      count: values.count,
      fromMessageId: from,
      ...flags,
    });
  };

  const body = (flags: Flags, pinnedFrom: string | null) => {
    const request = build(flags, pinnedFrom);
    if (request === undefined) throw new Error('The form is not valid.');
    return request;
  };
  const current = build({ dryRun: true, confirm: false }, null);
  const valid = current !== undefined;
  const [outcome, record] = useRunOutcome<PurgeResult>(
    current === undefined ? undefined : JSON.stringify(current),
  );

  return (
    <ToolCard description={t('purge.description')}>
      <Form form={form} layout="vertical" initialValues={{ mode: 'last', count: 10 }}>
        <Form.Item name="mode" label={t('purge.modeLabel')}>
          <Segmented
            options={[
              { value: 'last', label: t('purge.modeLast') },
              { value: 'range', label: t('purge.modeRange') },
            ]}
          />
        </Form.Item>
        <Form.Item name="channelId" label={t('purge.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={PURGE_CHANNEL_TYPES} />
        </Form.Item>
        {range ? (
          <>
            <Form.Item
              name="until"
              label={t('purge.untilLabel')}
              extra={t('purge.untilHelp')}
              validateTrigger="onBlur"
              rules={[
                { required: true, whitespace: true, message: t('common.required') },
                messageRule,
              ]}
            >
              <Input allowClear />
            </Form.Item>
            <Form.Item
              name="from"
              label={t('purge.fromLabel')}
              extra={t('purge.fromHelp')}
              validateTrigger="onBlur"
              rules={[messageRule]}
            >
              <Input allowClear />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="count"
            label={t('purge.countLabel')}
            extra={t('purge.countHelp', { max: PURGE_COUNT_MAX })}
            rules={[required]}
          >
            <InputNumber min={1} max={PURGE_COUNT_MAX} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        )}
      </Form>
      <ValidatedAction form={form} valid={valid}>
        <ConfirmAction
          label={range ? t('purge.labelRange') : t('purge.labelLast', { count: values.count ?? 0 })}
          modalTitle={t('purge.modalTitle')}
          confirmLabel={t('purge.confirm')}
          preview={async () => {
            const plan = await postTool(
              guildId,
              'purge',
              body({ dryRun: true, confirm: false }, null),
              PurgePlanSchema,
            );
            plannedFrom.current = plan.fromMessageId;
            return plan;
          }}
          execute={() =>
            postTool(
              guildId,
              'purge',
              body({ dryRun: false, confirm: true }, plannedFrom.current),
              PurgeResultSchema,
            )
          }
          renderPlan={(plan) => <PurgePlanView plan={plan} />}
          canConfirm={(plan) => plan.status === 'OK' && plan.count > 0}
          onDone={(result) => {
            record(result);
            done(t('purge.done'));
          }}
        />
      </ValidatedAction>
      {outcome === undefined ? null : (
        <ResultBlock>
          <PurgeOutcome result={outcome} />
        </ResultBlock>
      )}
    </ToolCard>
  );
}
