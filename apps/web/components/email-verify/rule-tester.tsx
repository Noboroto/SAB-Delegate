'use client';

import { useMemo, useState } from 'react';
import { Alert, Card, Input, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { EMAIL_ADDRESS_MAX } from '@sab/shared';
import { useRoles } from '@/lib/discord/use-roles';
import { testEmailAccess, type RuleDraft } from '@/lib/email-verify/rule-draft';

interface RuleTesterProps {
  guildId: string;
  /** The rules as they are being edited, saved or not. */
  drafts: readonly RuleDraft[];
  blockPatterns: readonly string[];
  defaultRoleIds: readonly string[];
}

/** Judges a typed address with the shared matcher against the rules on screen, before they are saved. */
export function RuleTester({ guildId, drafts, blockPatterns, defaultRoleIds }: RuleTesterProps) {
  const t = useTranslations('web-email-verify.rules.tester');
  const roles = useRoles(guildId);
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState('');

  const outcome = useMemo(
    () =>
      email.trim() === ''
        ? undefined
        : testEmailAccess({ drafts, email, invite, blockPatterns, defaultRoleIds }),
    [drafts, email, invite, blockPatterns, defaultRoleIds],
  );

  const roleNames = (outcome?.result.roleIds ?? []).map(
    (id) => roles.data?.find((role) => role.id === id)?.name ?? id,
  );
  const status = outcome?.result.status;

  return (
    <Card title={t('title')}>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Typography.Text type="secondary">{t('intro')}</Typography.Text>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-tester-email">{t('email')}</label>
          <Input
            id="ev-tester-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={EMAIL_ADDRESS_MAX}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-tester-invite">{t('invite')}</label>
          <Input
            id="ev-tester-invite"
            autoComplete="off"
            maxLength={200}
            placeholder={t('invitePlaceholder')}
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
          />
        </div>
        <div aria-live="polite" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {outcome === undefined || status === undefined ? (
            <Typography.Text type="secondary">{t('empty')}</Typography.Text>
          ) : (
            <>
              <Alert
                type={
                  status === 'ACCEPTED' ? 'success' : status === 'BLOCKED' ? 'error' : 'warning'
                }
                showIcon
                title={t(`results.${status}`)}
                description={
                  status === 'ACCEPTED'
                    ? roleNames.length > 0
                      ? t('roles', { names: roleNames.join(', ') })
                      : t('noRoles')
                    : undefined
                }
              />
              {outcome.usesLists ? (
                <Typography.Text type="secondary">{t('listNote')}</Typography.Text>
              ) : null}
              {outcome.skipped > 0 ? (
                <Typography.Text type="secondary">
                  {t('skipped', { count: outcome.skipped })}
                </Typography.Text>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
