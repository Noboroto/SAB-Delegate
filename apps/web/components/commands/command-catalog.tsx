'use client';

import { Card, Col, Row, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { CommandCatalogEntry } from '@sab/shared';
import { Heading } from '@/components/ui/heading';
import { PageState } from '@/components/ui/page-state';
import { groupCommands } from '@/lib/commands/group-commands';

function CommandCard({ command }: { command: CommandCatalogEntry }) {
  const t = useTranslations('web-commands');

  return (
    <Card
      size="small"
      style={{ height: '100%' }}
      title={<span style={{ overflowWrap: 'anywhere' }}>{`/${command.name}`}</span>}
      extra={command.guildOnly ? <Tag>{t('guildOnly')}</Tag> : null}
    >
      <Typography.Paragraph style={{ marginBottom: command.subcommands.length > 0 ? 8 : 0 }}>
        {command.description}
      </Typography.Paragraph>
      {command.subcommands.length > 0 ? (
        <ul aria-label={t('subcommands')} style={{ margin: 0, paddingInlineStart: 20 }}>
          {command.subcommands.map((sub) => (
            <li key={sub.name} style={{ overflowWrap: 'anywhere' }}>
              <Typography.Text code>{`/${command.name} ${sub.name}`}</Typography.Text>{' '}
              <Typography.Text type="secondary">{sub.description}</Typography.Text>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function CommandGroup({ title, commands }: { title: string; commands: CommandCatalogEntry[] }) {
  if (commands.length === 0) return null;

  return (
    <section aria-label={title} style={{ marginBottom: 24 }}>
      <Typography.Title level={2} style={{ fontSize: 18 }}>
        {title}
      </Typography.Title>
      <Row gutter={[16, 16]}>
        {commands.map((command) => (
          <Col key={command.name} xs={24} lg={12}>
            <CommandCard command={command} />
          </Col>
        ))}
      </Row>
    </section>
  );
}

/** Every slash command of the bot, grouped by who may use it by default; text only, nothing to run here. */
export function CommandCatalog({ commands }: { commands: readonly CommandCatalogEntry[] }) {
  const t = useTranslations('web-commands');
  const groups = groupCommands(commands);

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      {commands.length === 0 ? (
        <PageState status="info" headingLevel={2} title={t('empty.title')} body={t('empty.body')} />
      ) : (
        <>
          <CommandGroup title={t('groupEveryone')} commands={groups.everyone} />
          <CommandGroup title={t('groupRestricted')} commands={groups.restricted} />
        </>
      )}
    </>
  );
}
