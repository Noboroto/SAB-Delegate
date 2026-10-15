'use client';

import { useMemo, useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { ActionRow } from '@/components/ui/action-row';
import { Heading } from '@/components/ui/heading';
import { PageState } from '@/components/ui/page-state';
import { useRoles } from '@/lib/discord/use-roles';
import { groupNotesByRole } from '@/lib/note/group-notes';
import type { NoteView } from '@/lib/note/note-schemas';
import { NoteForm } from './note-form';
import { NoteCard } from './note-card';

interface NotePageProps {
  guildId: string;
  notes: readonly NoteView[];
}

type Editor = { note: NoteView | undefined } | undefined;

export function NotePage({ guildId, notes }: NotePageProps) {
  const t = useTranslations('web-note');
  const roles = useRoles(guildId);
  const [editor, setEditor] = useState<Editor>(undefined);

  const roleNames = useMemo(
    () => new Map((roles.data ?? []).map((role) => [role.id, role.name])),
    [roles.data],
  );
  const groups = useMemo(
    () =>
      groupNotesByRole(
        notes,
        (roles.data ?? []).map((role) => role.id),
      ),
    [notes, roles.data],
  );

  const roleLabel = (roleId: string): string => {
    const name = roleNames.get(roleId);
    if (name !== undefined) return name;
    return roles.loading ? t('role.loading') : t('role.unknown', { id: roleId });
  };

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      {groups.length === 0 ? null : (
        <ActionRow style={{ marginBottom: 'var(--space-4)' }}>
          <Button type="primary" onClick={() => setEditor({ note: undefined })}>
            {t('add')}
          </Button>
        </ActionRow>
      )}
      {groups.length === 0 ? (
        <PageState
          status="info"
          headingLevel={2}
          title={t('empty.title')}
          body={t('empty.body')}
          action={{ label: t('add'), onClick: () => setEditor({ note: undefined }) }}
        />
      ) : (
        groups.map((group) => (
          <section key={group.roleId} style={{ marginBottom: 24 }}>
            <Typography.Title level={2} style={{ fontSize: 18, overflowWrap: 'anywhere' }}>
              {roleLabel(group.roleId)}{' '}
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                ({t('role.count', { count: group.notes.length })})
              </Typography.Text>
            </Typography.Title>
            {group.notes.map((note) => (
              <NoteCard
                key={note.topic}
                guildId={guildId}
                note={note}
                onEdit={(target) => setEditor({ note: target })}
              />
            ))}
          </section>
        ))
      )}
      <Modal
        open={editor !== undefined}
        title={editor?.note === undefined ? t('form.addTitle') : t('form.editTitle')}
        footer={null}
        onCancel={() => setEditor(undefined)}
        destroyOnHidden
      >
        <NoteForm
          guildId={guildId}
          editing={editor?.note}
          existing={notes}
          onSaved={() => setEditor(undefined)}
        />
      </Modal>
    </>
  );
}
