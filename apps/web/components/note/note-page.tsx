'use client';

import { useMemo, useState } from 'react';
import { Button, Modal, Typography, theme } from 'antd';
import { useTranslations } from 'next-intl';
import { useConfirmLeave } from '@/components/forms/unsaved-guard';
import { ActionRow } from '@/components/ui/action-row';
import { Heading } from '@/components/ui/heading';
import { PageState } from '@/components/ui/page-state';
import { SectionTitle } from '@/components/ui/section-title';
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
  const { token } = theme.useToken();
  const confirmLeave = useConfirmLeave();
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
          <section key={group.roleId} style={{ marginBottom: 'var(--space-6)' }}>
            <SectionTitle>
              {roleLabel(group.roleId)}{' '}
              <Typography.Text type="secondary" style={{ fontSize: token.fontSize }}>
                ({t('role.count', { count: group.notes.length })})
              </Typography.Text>
            </SectionTitle>
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
        // Several lines of text are one stray click from lost; only Cancel, the X or Esc close it, and those ask first.
        mask={{ closable: false }}
        onCancel={() => confirmLeave(() => setEditor(undefined))}
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
