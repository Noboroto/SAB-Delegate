'use client';

import { useState } from 'react';
import { App, Button, Card, Descriptions, Input, Tag } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EMAIL_ADDRESS_MAX, type EmailVerifyStatus } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { sendEmailTestMail } from '@/lib/email-verify/email-verify-api';

/** Where verification stands: the switch, whether mail can go out, the counts and today's mail budget. */
export function OverviewCard({ guildId, status }: { guildId: string; status: EmailVerifyStatus }) {
  const t = useTranslations('web-email-verify.overview');
  const { message } = App.useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const sendTest = useApiMutation((address: string) =>
    sendEmailTestMail(guildId, { email: address }),
  );

  const onSend = async () => {
    const outcome = await sendTest.run(email.trim());
    if (outcome?.ok !== true) return;
    void message.success(t('testMailSent'));
    // The mail just sent counts against today's budget shown above.
    router.refresh();
  };

  return (
    <Card>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Descriptions
          bordered
          size="small"
          column={{ xs: 1, md: 2 }}
          items={[
            {
              key: 'enabled',
              label: t('enabled'),
              children: (
                <Tag color={status.enabled ? 'success' : 'default'}>
                  {status.enabled ? t('on') : t('off')}
                </Tag>
              ),
            },
            {
              key: 'smtp',
              label: t('smtp'),
              children: status.smtpReady ? (
                <Tag color="success">{t('smtpReady')}</Tag>
              ) : (
                <Tag color="warning">{t('smtpNotReady')}</Tag>
              ),
            },
            { key: 'verified', label: t('verified'), children: status.verified },
            { key: 'pending', label: t('pending'), children: status.pending },
            { key: 'rules', label: t('rules'), children: status.rules },
            { key: 'lists', label: t('lists'), children: status.lists },
            {
              key: 'sent',
              label: t('sentToday'),
              children: t('sentTodayValue', { count: status.sentToday, cap: status.dailyCap }),
            },
          ]}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim() !== '') void onSend();
          }}
          style={{ display: 'grid', gap: 'var(--space-2)' }}
        >
          <label htmlFor="ev-test-mail">{t('testMailEmail')}</label>
          <ActionRow>
            <Input
              id="ev-test-mail"
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={EMAIL_ADDRESS_MAX}
              value={email}
              onChange={(event) => {
                sendTest.reset();
                setEmail(event.target.value);
              }}
              style={{ flex: '1 1 var(--w-sm)', width: 'auto', minWidth: 0 }}
            />
            <Button
              htmlType="submit"
              loading={sendTest.pending}
              disabled={email.trim() === '' || !status.smtpReady}
            >
              {t('testMail')}
            </Button>
          </ActionRow>
          {sendTest.error === undefined ? null : <ErrorAlert error={sendTest.error} />}
        </form>
      </div>
    </Card>
  );
}
