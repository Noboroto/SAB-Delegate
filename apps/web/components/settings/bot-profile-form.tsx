'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Avatar, Button, Card, Form, Input, Popconfirm, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { BotProfileSetResultSchema, type BotProfile } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { apiFetch } from '@/lib/api/api-fetch';
import { useApiMutation } from '@/lib/api/mutations';
import {
  AVATAR_ACCEPT,
  AVATAR_MAX_KIB,
  readAvatarFile,
  type AvatarFileError,
} from '@/lib/settings/avatar-file';
import { guildApiPath } from '@/lib/guild-path';

/** Discord's limit for a nickname; the server rejects anything longer. */
const NICK_MAX_LENGTH = 32;

interface BotProfileFormProps {
  guildId: string;
  profile: BotProfile;
}

interface ProfileChange {
  nick?: string | null;
  /** `null` drops the server picture, so the bot's own shows again. */
  avatar?: string | null;
}

interface PickedAvatar {
  base64: string;
  previewUrl: string;
}

/** The bot's nickname and picture on this one server. */
export function BotProfileForm({ guildId, profile }: BotProfileFormProps) {
  const t = useTranslations('web-settings.botProfile');
  const tCommon = useTranslations('web-common');
  const { message } = App.useApp();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [nick, setNick] = useState(profile.nick ?? '');
  const [picked, setPicked] = useState<PickedAvatar | undefined>(undefined);
  const [fileError, setFileError] = useState<AvatarFileError | undefined>(undefined);

  const save = useApiMutation((body: ProfileChange) =>
    apiFetch(guildApiPath(guildId, 'bot-profile'), {
      method: 'PATCH',
      body,
      parser: BotProfileSetResultSchema,
    }),
  );

  const trimmedNick = nick.trim();
  const nickChanged = trimmedNick !== (profile.nick ?? '');
  const changed = nickChanged || picked !== undefined;

  const submit = async (
    body: ProfileChange,
    success: string,
    onSaved: (saved: BotProfile) => void,
  ) => {
    const outcome = await save.run(body);
    if (outcome === undefined) return;
    // The nickname is applied before the picture, so a refused picture can
    // still leave a new nickname behind; the page is re-read either way.
    router.refresh();
    if (!outcome.ok) return;
    void message.success(success);
    onSaved(outcome.data.profile);
  };

  const onSave = () => {
    const body: ProfileChange = {};
    if (nickChanged) body.nick = trimmedNick === '' ? null : trimmedNick;
    if (picked !== undefined) body.avatar = picked.base64;
    return submit(body, t('saved'), (saved) => {
      setNick(saved.nick ?? '');
      setPicked(undefined);
    });
  };

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again after a rejection still fires.
    event.target.value = '';
    if (file === undefined) return;
    const result = await readAvatarFile(file);
    if (result.ok) {
      setFileError(undefined);
      setPicked({ base64: result.base64, previewUrl: result.previewUrl });
    } else {
      setFileError(result.error);
    }
  };

  return (
    <Card title={t('title')}>
      <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
        <Typography.Text type="secondary">{t('description')}</Typography.Text>
        <Form layout="vertical" onFinish={() => void onSave()} disabled={save.pending}>
          <Form.Item
            label={t('nick')}
            extra={t('nickHelp', { max: NICK_MAX_LENGTH })}
            htmlFor="bot-nick"
          >
            <Input
              id="bot-nick"
              value={nick}
              maxLength={NICK_MAX_LENGTH}
              placeholder={t('nickPlaceholder')}
              onChange={(event) => setNick(event.target.value)}
            />
          </Form.Item>
          <Form.Item
            label={t('avatar')}
            extra={t('avatarHelp', { size: AVATAR_MAX_KIB })}
            validateStatus={fileError === undefined ? undefined : 'error'}
            help={
              fileError === undefined
                ? undefined
                : t(`fileErrors.${fileError}`, { size: AVATAR_MAX_KIB })
            }
          >
            <Space size={16} wrap align="center">
              <Space orientation="vertical" size={4} align="center">
                <Avatar size={64} src={picked?.previewUrl ?? profile.avatarUrl ?? undefined} />
                <Typography.Text type="secondary">
                  {picked !== undefined
                    ? t('avatarNew')
                    : profile.avatarUrl === null
                      ? t('avatarDefault')
                      : t('avatarCurrent')}
                </Typography.Text>
              </Space>
              <input
                ref={fileInput}
                type="file"
                accept={AVATAR_ACCEPT}
                aria-label={t('avatarPick')}
                style={{ display: 'none' }}
                onChange={(event) => void onFileChosen(event)}
              />
              <Button disabled={save.pending} onClick={() => fileInput.current?.click()}>
                {picked === undefined ? t('avatarPick') : t('avatarPickAgain')}
              </Button>
              {picked === undefined ? null : (
                <Button disabled={save.pending} onClick={() => setPicked(undefined)}>
                  {t('avatarDiscard')}
                </Button>
              )}
            </Space>
          </Form.Item>
          {save.error === undefined ? null : <ErrorAlert error={save.error} />}
          <Space wrap style={{ marginTop: save.error === undefined ? 0 : 16 }}>
            <Button type="primary" htmlType="submit" loading={save.pending} disabled={!changed}>
              {t('save')}
            </Button>
            <Button
              disabled={save.pending || profile.nick === null}
              onClick={() => void submit({ nick: null }, t('restoreNickDone'), () => setNick(''))}
            >
              {t('restoreNick')}
            </Button>
            <Popconfirm
              title={t('restoreAvatarConfirm')}
              okText={t('restoreAvatarConfirmOk')}
              cancelText={tCommon('cancel')}
              okButtonProps={{ danger: true }}
              disabled={save.pending || profile.avatarUrl === null}
              onConfirm={() =>
                void submit({ avatar: null }, t('restoreAvatarDone'), () => setPicked(undefined))
              }
            >
              <Button danger disabled={save.pending || profile.avatarUrl === null}>
                {t('restoreAvatar')}
              </Button>
            </Popconfirm>
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
