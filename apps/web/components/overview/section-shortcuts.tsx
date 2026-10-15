'use client';

import { Card, Col, Row } from 'antd';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GUILD_SECTIONS, guildSectionPath, type GuildSection } from '@/lib/guild-sections';

/** One card per part of the dashboard, each saying what is there; the whole card is the link. */
export function SectionShortcuts({ guildId }: { guildId: string }) {
  const t = useTranslations('web-overview');
  const nav = useTranslations('servers.nav');

  // A record, so a section added to the navigation cannot ship without a description.
  const descriptions: Record<GuildSection, string> = {
    modules: t('shortcuts.modules'),
    commands: t('shortcuts.commands'),
    auditLog: t('shortcuts.auditLog'),
    settings: t('shortcuts.settings'),
  };

  return (
    <section aria-label={t('shortcuts.title')}>
      <Row gutter={[16, 16]}>
        {GUILD_SECTIONS.map((section) => (
          <Col key={section} xs={24} sm={12} xl={6}>
            <Link
              href={`/servers/${guildId}/${guildSectionPath(section)}`}
              style={{ display: 'block', height: '100%' }}
            >
              <Card hoverable style={{ height: '100%' }}>
                <Card.Meta title={nav(section)} description={descriptions[section]} />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </section>
  );
}
