'use client';

import { useState } from 'react';
import { App, Button, Card, Form, InputNumber, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  WORD_MAX_WORDS_MAX,
  WORD_MAX_WORDS_MIN,
  type WordGameConfigResult,
  type WordGameInfo,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { useUnsavedChanges } from '@/components/forms/unsaved-guard';
import { useApiMutation } from '@/lib/api/mutations';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { configureWordGame, type WordGameChange } from '@/lib/word-game/word-game-api';
import { WordSample } from './word-sample';

/**
 * Which fields differ from what is stored. A new channel starts a new round
 * and clears the used words, so that save goes through the service's plan;
 * a limit alone leaves the round alone and is saved straight away.
 */
function changeOf(
  info: WordGameInfo,
  channelId: string | undefined,
  maxWords: number | null,
): WordGameChange {
  return {
    ...(channelId !== undefined && channelId !== info.channelId ? { channelId } : {}),
    ...(maxWords !== null && maxWords !== info.maxWords ? { maxWords } : {}),
  };
}

export function WordGameConfigForm({ guildId, info }: { guildId: string; info: WordGameInfo }) {
  const t = useTranslations('web-word-game');
  const { message } = App.useApp();
  const router = useRouter();
  const [channelId, setChannelId] = useState<string | undefined>(info.channelId ?? undefined);
  const [maxWords, setMaxWords] = useState<number | null>(info.maxWords);

  const change = changeOf(info, channelId, maxWords);
  const hasChange = change.channelId !== undefined || change.maxWords !== undefined;
  const startsNewRound = change.channelId !== undefined;
  useUnsavedChanges(hasChange);
  // Cleared input is `null`; a half-typed number outside the limits is the server's 400 otherwise.
  const limitInvalid =
    maxWords === null ||
    !Number.isInteger(maxWords) ||
    maxWords < WORD_MAX_WORDS_MIN ||
    maxWords > WORD_MAX_WORDS_MAX;

  const save = useApiMutation(() => configureWordGame(guildId, change, false));

  const submitLimit = async () => {
    // Enter in a field submits the form too; a new channel is saved only through its plan.
    if (startsNewRound || !hasChange || limitInvalid) return;
    const outcome = await save.run(undefined);
    if (outcome?.ok !== true) return;
    void message.success(t('config.done'));
    router.refresh();
  };

  return (
    <Card title={t('config.title')}>
      <Form layout="vertical" onFinish={() => void submitLimit()}>
        <Form.Item label={t('config.channel')} htmlFor="word-game-channel">
          <ChannelSelect
            id="word-game-channel"
            guildId={guildId}
            types={TEXT_CHANNEL_TYPES}
            value={channelId}
            onChange={setChannelId}
          />
        </Form.Item>
        <Form.Item
          label={t('config.maxWords')}
          htmlFor="word-game-max-words"
          extra={t('config.maxWordsHelp', { min: WORD_MAX_WORDS_MIN, max: WORD_MAX_WORDS_MAX })}
          validateStatus={limitInvalid ? 'error' : undefined}
        >
          <InputNumber
            id="word-game-max-words"
            min={WORD_MAX_WORDS_MIN}
            max={WORD_MAX_WORDS_MAX}
            precision={0}
            value={maxWords}
            onChange={setMaxWords}
            style={{ width: '100%' }}
          />
        </Form.Item>
        {startsNewRound ? (
          <Typography.Paragraph type="secondary">{t('config.newRoundNote')}</Typography.Paragraph>
        ) : null}
        {save.error === undefined ? null : (
          <Form.Item>
            <ErrorAlert error={save.error} />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          {startsNewRound ? (
            <ConfirmAction
              label={t('config.saveNewRound')}
              modalTitle={t('config.modalTitle')}
              confirmLabel={t('config.confirmNewRound')}
              disabled={limitInvalid}
              preview={() => configureWordGame(guildId, change, true)}
              execute={() => configureWordGame(guildId, change, false)}
              renderPlan={(plan: WordGameConfigResult) => (
                <>
                  <Typography.Paragraph>
                    {t('config.plan', { count: plan.clearedWords })}
                  </Typography.Paragraph>
                  <WordSample words={plan.sample} />
                </>
              )}
              onDone={() => {
                void message.success(t('config.done'));
                router.refresh();
              }}
            />
          ) : (
            <Button
              type="primary"
              htmlType="submit"
              loading={save.pending}
              disabled={!hasChange || limitInvalid}
            >
              {t('config.save')}
            </Button>
          )}
        </Form.Item>
      </Form>
    </Card>
  );
}
