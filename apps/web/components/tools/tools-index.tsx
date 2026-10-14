'use client';

import { Card, Col, Row } from 'antd';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';

/** The tool pages in the order the index shows them; the folder name is the route. */
const TOOL_ROUTES = [
  'mention',
  'role-assign',
  'threads',
  'purge',
  'activity',
  'attendance',
  'info',
] as const;

/** One card per tool, each saying what it does; the whole card is the link. */
export function ToolsIndex({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const copy: Record<(typeof TOOL_ROUTES)[number], { name: string; description: string }> = {
    mention: { name: t('tools.mention.name'), description: t('tools.mention.description') },
    'role-assign': {
      name: t('tools.roleAssign.name'),
      description: t('tools.roleAssign.description'),
    },
    threads: { name: t('tools.threads.name'), description: t('tools.threads.description') },
    purge: { name: t('tools.purge.name'), description: t('tools.purge.description') },
    activity: { name: t('tools.activity.name'), description: t('tools.activity.description') },
    attendance: {
      name: t('tools.attendance.name'),
      description: t('tools.attendance.description'),
    },
    info: { name: t('tools.info.name'), description: t('tools.info.description') },
  };

  return (
    <>
      <Heading title={t('index.title')} subtitle={t('index.subtitle')} />
      <Row gutter={[16, 16]}>
        {TOOL_ROUTES.map((route) => (
          <Col key={route} xs={24} sm={12} xl={8}>
            <Link
              href={`/servers/${guildId}/tools/${route}`}
              style={{ display: 'block', height: '100%' }}
            >
              <Card hoverable style={{ height: '100%' }}>
                <Card.Meta title={copy[route].name} description={copy[route].description} />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </>
  );
}
