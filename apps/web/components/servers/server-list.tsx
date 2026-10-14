'use client';

import { Avatar, Button, Card, Col, Row } from 'antd';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { GuildPickerItem } from '@sab/shared';
import { guildIconUrl } from '@/lib/discord-icon';

export function ServerList({ guilds }: { guilds: readonly GuildPickerItem[] }) {
  const t = useTranslations('servers');

  return (
    <Row gutter={[16, 16]}>
      {guilds.map((guild) => (
        <Col key={guild.id} xs={24} sm={12} lg={8} xl={6}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              {/* Decorative: the name is printed right beside it. */}
              <Avatar size={48} src={guildIconUrl(guild.id, guild.icon)} alt="">
                {guild.name.slice(0, 1).toUpperCase()}
              </Avatar>
              <strong style={{ overflowWrap: 'anywhere' }}>{guild.name}</strong>
            </div>
            <Link href={`/servers/${guild.id}`}>
              <Button type="primary" block>
                {t('open')}
              </Button>
            </Link>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
