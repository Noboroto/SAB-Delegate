'use client';

import { Avatar, Button, Card, Col, Grid, Row, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildBotInviteUrl, type GuildPickerItem } from '@sab/shared';
import { ActionRow } from '@/components/ui/action-row';
import { LinkButton } from '@/components/ui/link-button';
import { guildIconUrl } from '@/lib/discord-icon';

/** Column spans of both card grids; the invite preview is exactly one row of them. */
const COL_SPANS = { xs: 24, sm: 12, lg: 8, xl: 6 } as const;
const DESKTOP_COLUMNS = 4;

/** Columns of the grid at the current width. Before the width is measured nothing is set: assume desktop. */
function columnsOf(screens: Partial<Record<string, boolean>>): number {
  if (screens.xl === true) return 4;
  if (screens.lg === true) return 3;
  if (screens.sm === true) return 2;
  if (screens.xs === true) return 1;
  return DESKTOP_COLUMNS;
}

function GuildIdentity({ guild, size }: { guild: GuildPickerItem; size: number }) {
  return (
    <>
      {/* Decorative: the name is printed right beside it. */}
      <Avatar size={size} src={guildIconUrl(guild.id, guild.icon)} alt="">
        {guild.name.slice(0, 1).toUpperCase()}
      </Avatar>
      <strong style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{guild.name}</strong>
    </>
  );
}

export function ServerList({ guilds }: { guilds: readonly GuildPickerItem[] }) {
  const t = useTranslations('servers');
  const screens = Grid.useBreakpoint();
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const revealFrom = useRef(0);

  const managed = guilds.filter((guild) => guild.botPresent);
  // A server without an invite link would be a row with nothing to press.
  const invitable = guilds.filter((guild) => !guild.botPresent && guild.invite !== null);
  const columns = columnsOf(screens);
  const shown = expanded ? invitable : invitable.slice(0, columns);
  // Every item carries the same client id and permissions, so any one builds the general link.
  const anyInvite = invitable[0]?.invite ?? null;

  useEffect(() => {
    if (!expanded) return;
    listRef.current
      ?.querySelectorAll<HTMLElement>('[data-invite-action]')
      [revealFrom.current]?.focus();
  }, [expanded]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <section aria-labelledby="servers-manage">
        <Typography.Title level={2} id="servers-manage" style={{ fontSize: 18, marginTop: 0 }}>
          {t('groups.manage')}
        </Typography.Title>
        {managed.length === 0 ? (
          <Typography.Text type="secondary">
            {invitable.length > 0 ? (
              t('empty.botAbsent')
            ) : (
              <>
                {t('empty.title')}. {t('empty.body')}
              </>
            )}
          </Typography.Text>
        ) : (
          <Row gutter={[16, 16]}>
            {managed.map((guild) => (
              <Col key={guild.id} {...COL_SPANS}>
                <Card>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      marginBottom: 'var(--space-4)',
                    }}
                  >
                    <GuildIdentity guild={guild} size={48} />
                  </div>
                  <LinkButton
                    href={`/servers/${guild.id}`}
                    variant="primary"
                    aria-label={t('openTo', { name: guild.name })}
                  >
                    {t('open')}
                  </LinkButton>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </section>

      {invitable.length > 0 && (
        <section aria-labelledby="servers-invite">
          <Typography.Title level={2} id="servers-invite" style={{ fontSize: 18, marginTop: 0 }}>
            {t('groups.invite')}
          </Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {anyInvite !== null && (
              <ActionRow>
                <Button
                  type="primary"
                  href={buildBotInviteUrl(anyInvite)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('invite')}
                </Button>
              </ActionRow>
            )}
            <div ref={listRef}>
              <Row gutter={[16, 16]} role="list">
                {shown.map((guild) => (
                  <Col key={guild.id} role="listitem" {...COL_SPANS}>
                    <Card size="small">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                        }}
                      >
                        <GuildIdentity guild={guild} size={32} />
                        {guild.invite !== null && (
                          <Button
                            data-invite-action=""
                            style={{ marginLeft: 'auto', flexShrink: 0 }}
                            href={buildBotInviteUrl({ ...guild.invite, guildId: guild.id })}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t('inviteTo', { name: guild.name })}
                          >
                            {t('inviteShort')}
                          </Button>
                        )}
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
            {invitable.length > columns && (
              <ActionRow>
                <Button
                  aria-expanded={expanded}
                  onClick={() => {
                    revealFrom.current = columns;
                    setExpanded((open) => !open);
                  }}
                >
                  {expanded ? t('showLess') : t('showMore', { count: invitable.length - columns })}
                </Button>
              </ActionRow>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
