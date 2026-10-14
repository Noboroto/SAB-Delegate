'use client';

import { useState } from 'react';
import { UserOutlined } from '@ant-design/icons';
import { App, Button, Dropdown } from 'antd';
import { useTranslations } from 'next-intl';
import { signOut } from '@/lib/auth/auth-client';

export function UserMenu() {
  const t = useTranslations('servers.userMenu');
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
          { key: 'account', label: t('account'), disabled: true },
          { key: 'signOut', label: t('signOut'), onClick: () => void leave() },
        ],
      }}
    >
      <Button icon={<UserOutlined />} loading={leaving} aria-label={t('label')} />
    </Dropdown>
  );
}
