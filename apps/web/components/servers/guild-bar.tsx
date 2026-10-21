'use client';

import { Avatar, Menu, Select } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { GuildPickerItem } from '@sab/shared';
import { guildIconUrl } from '@/lib/discord-icon';
import {
  GUILD_NAV,
  activeNavKey,
  type GuildNavChildKey,
  type GuildNavKey,
} from '@/lib/guild-sections';

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
  const active = activeNavKey(pathname, currentId);

  // Typed records, so a page added to the registry cannot ship without a label.
  const labels: Record<GuildNavKey | GuildNavChildKey, string> = {
    overview: t('nav.overview'),
    modules: t('nav.modules'),
    tools: t('nav.tools'),
    commands: t('nav.commands'),
    auditLog: t('nav.auditLog'),
    settings: t('nav.settings'),
    birthday: t('nav.birthday'),
    note: t('nav.note'),
    wordGame: t('nav.wordGame'),
    games: t('nav.games'),
    chatbot: t('nav.chatbot'),
    emailVerify: t('nav.emailVerify'),
    schedule: t('nav.schedule'),
    messaging: t('nav.messaging'),
    mention: t('nav.mention'),
    roleAssign: t('nav.roleAssign'),
    threads: t('nav.threads'),
    purge: t('nav.purge'),
    activity: t('nav.activity'),
    attendance: t('nav.attendance'),
    info: t('nav.info'),
  };
  const link = (key: GuildNavKey | GuildNavChildKey, path: string) => (
    <Link href={path === '' ? base : `${base}/${path}`}>{labels[key]}</Link>
  );

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
        style={{ minWidth: 'var(--w-sm)', maxWidth: '100%' }}
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
        selectedKeys={active === undefined ? [] : [active]}
        style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent' }}
        items={GUILD_NAV.map((entry) =>
          entry.children === undefined
            ? { key: entry.key, label: link(entry.key, entry.path ?? '') }
            : {
                key: entry.key,
                label: entry.path === undefined ? labels[entry.key] : link(entry.key, entry.path),
                children: entry.children.map((child) => ({
                  key: child.key,
                  label: link(child.key, child.path),
                })),
              },
        )}
      />
    </div>
  );
}
