'use client';

import { Card, Col, Row } from 'antd';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { MODULE_PAGES } from '@/lib/guild-sections';

/** Cards to the module pages; a module is switched on and off in its own page, not here. */
export function ModulesIndex({ guildId }: { guildId: string }) {
  const t = useTranslations('servers.nav');

  // Typed record, so a module added to the registry cannot ship without a description.
  const names: Record<(typeof MODULE_PAGES)[number]['key'], [string, string]> = {
    birthday: [t('birthday'), t('moduleDesc.birthday')],
    note: [t('note'), t('moduleDesc.note')],
    wordGame: [t('wordGame'), t('moduleDesc.wordGame')],
    games: [t('games'), t('moduleDesc.games')],
    chatbot: [t('chatbot'), t('moduleDesc.chatbot')],
    schedule: [t('schedule'), t('moduleDesc.schedule')],
    messaging: [t('messaging'), t('moduleDesc.messaging')],
  };

  return (
    <>
      <Heading title={t('modules')} subtitle={t('modulesSubtitle')} />
      <Row gutter={[16, 16]}>
        {MODULE_PAGES.map((page) => {
          const [title, description] = names[page.key];
          return (
            <Col key={page.key} xs={24} sm={12} xl={8}>
              <Link
                href={`/servers/${guildId}/${page.path}`}
                style={{ display: 'block', height: '100%' }}
              >
                <Card hoverable style={{ height: '100%' }}>
                  <Card.Meta title={title} description={description} />
                </Card>
              </Link>
            </Col>
          );
        })}
      </Row>
    </>
  );
}
