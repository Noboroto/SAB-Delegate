'use client';

import { useState } from 'react';
import { UserOutlined } from '@ant-design/icons';
import { App, Avatar, Button, Dropdown } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Me } from '@sab/shared';
import { signOut } from '@/lib/auth/auth-client';

/**
 * The account button and its menu. The name and picture come from the server
 * and are null when Discord could not be asked: the button then shows the
 * plain icon, as does a picture that fails to load.
 */
export function UserMenu({
  account,
}: {
  account: Pick<Me, 'username' | 'globalName' | 'avatarUrl'>;
}) {
  const displayName = account.globalName ?? account.username;
  const t = useTranslations('servers.userMenu');
  const tKeys = useTranslations('web-api-keys');
  const router = useRouter();
  const { message } = App.useApp();
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await signOut();
    } catch (error) {
      console.error(error);
      void message.error(t('signOutFailed'));
      setLeaving(false);
    }
  };

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            // A group title is not focusable or clickable, unlike a disabled
            // item, and stays readable in both themes.
            type: 'group',
            key: 'account',
            label: (
              <span style={{ display: 'flex', flexDirection: 'column', maxWidth: 240 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('account')}</span>
                {displayName !== null && (
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {displayName}
                  </span>
                )}
                {account.username !== null && (
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    @{account.username}
                  </span>
                )}
              </span>
            ),
            children: [
              // The whole row navigates: a link inside the label would only
              // answer on its text, a small target for a finger.
              {
                key: 'apiKeys',
                label: tKeys('menu'),
                onClick: () => router.push('/account/api-keys'),
              },
              { key: 'signOut', label: t('signOut'), onClick: () => void leave() },
            ],
          },
        ],
      }}
    >
      <Button
        icon={
          // Without `src` or when the image fails, Avatar shows `icon`.
          <Avatar
            size={24}
            src={account.avatarUrl ?? undefined}
            alt={displayName ?? ''}
            icon={<UserOutlined />}
          />
        }
        loading={leaving}
        aria-label={displayName === null ? t('label') : t('labelNamed', { name: displayName })}
      />
    </Dropdown>
  );
}
