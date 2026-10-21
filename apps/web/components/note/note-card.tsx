'use client';

import { App, Button, Typography, theme } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DiscordTimestamp } from '@/components/data/discord-timestamp';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { ActionRow } from '@/components/ui/action-row';
import { previewRemoveNote, removeNote } from '@/lib/note/note-api';
import type { NoteView } from '@/lib/note/note-schemas';

interface NoteCardProps {
  guildId: string;
  note: NoteView;
  onEdit: (note: NoteView) => void;
}

/** One note. Its text is shown as written (line breaks kept) and never as markup. */
export function NoteCard({ guildId, note, onEdit }: NoteCardProps) {
  const t = useTranslations('web-note');
  const { message } = App.useApp();
  const router = useRouter();
  const { token } = theme.useToken();
  const key = { roleId: note.roleId, topic: note.topic };

  return (
    <article style={{ padding: 'var(--space-3) 0' }}>
      <Typography.Title
        level={3}
        style={{ fontSize: token.fontSizeHeading5, marginTop: 0, overflowWrap: 'anywhere' }}
      >
        {note.topic}
      </Typography.Title>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.content}</div>
      <ActionRow style={{ marginTop: 'var(--space-2)' }}>
        <Button aria-label={t('edit.label', { topic: note.topic })} onClick={() => onEdit(note)}>
          {t('edit.button')}
        </Button>
        <ConfirmAction
          label={t('remove.button')}
          ariaLabel={t('remove.label', { topic: note.topic })}
          modalTitle={t('remove.modalTitle')}
          confirmLabel={t('remove.confirm')}
          preview={() => previewRemoveNote(guildId, key)}
          execute={() => removeNote(guildId, key)}
          canConfirm={(plan) => plan.count > 0}
          renderPlan={(plan) =>
            plan.count === 0 ? (
              <p>{t('remove.notFound')}</p>
            ) : (
              <>
                <p>{t('remove.plan', { count: plan.count })}</p>
                <ul>
                  {plan.sample.map((sample) => (
                    <li
                      key={`${sample.roleId}:${sample.topic}`}
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {sample.topic}
                    </li>
                  ))}
                </ul>
              </>
            )
          }
          onDone={() => {
            void message.success(t('remove.done'));
            router.refresh();
          }}
        />
        <Typography.Text type="secondary">
          {t('updated')} <DiscordTimestamp value={note.updatedAt} />
        </Typography.Text>
      </ActionRow>
    </article>
  );
}
