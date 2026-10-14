'use client';

import { Avatar, Menu, Select } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { GuildPickerItem } from '@sab/shared';
import { guildIconUrl } from '@/lib/discord-icon';
import { GUILD_SECTIONS } from '@/lib/guild-sections';

interface GuildBarProps {
  guilds: readonly GuildPickerItem[];
  currentId: string;
}

/** Server switcher and the section navigation of one server's dashboard. */
export function GuildBar({ guilds, currentId }: GuildBarProps) {
  const t = useTranslations('servers');
  const router = useRouter();
  const pathname = usePathname();

  const base = `/servers/${currentId}`;
  const section = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split('/')[0]
    : '';

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        marginBottom: 24,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <Select
        aria-label={t('switcher.label')}
        value={currentId}
        style={{ minWidth: 200, maxWidth: '100%' }}
        onChange={(id: string) => router.push(`/servers/${id}`)}
        options={[
          ...guilds.map((guild) => ({
            value: guild.id,
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Avatar size={20} src={guildIconUrl(guild.id, guild.icon, 32)} alt="">
                  {guild.name.slice(0, 1).toUpperCase()}
                </Avatar>
                {guild.name}
              </span>
            ),
          })),
        ]}
        popupRender={(menu) => (
          <>
            {menu}
            <Link href="/servers" style={{ display: 'block', padding: '8px 12px' }}>
              {t('switcher.all')}
            </Link>
          </>
        )}
      />
      <Menu
        mode="horizontal"
        aria-label={t('nav.label')}
        selectedKeys={[section === '' ? 'overview' : (section ?? 'overview')]}
        style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent' }}
        items={[
          { key: 'overview', label: <Link href={base}>{t('nav.overview')}</Link> },
          ...GUILD_SECTIONS.map((name) => ({
            key: name,
            label: <Link href={`${base}/${name}`}>{t(`nav.${name}`)}</Link>,
          })),
        ]}
      />
    </div>
  );
}
