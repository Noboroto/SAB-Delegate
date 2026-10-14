'use client';

import { App, Alert, Button, Form, Input } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NOTE_CONTENT_MAX_LENGTH, NOTE_TOPIC_MAX_LENGTH, NoteUpsertSchema } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { RoleSelect } from '@/components/forms/role-select';
import { useApiMutation } from '@/lib/api/mutations';
import { saveNote } from '@/lib/note/note-api';
import type { NoteView } from '@/lib/note/note-schemas';

interface FormValues {
  roleId?: string;
  topic?: string;
  content?: string;
}

type FieldName = keyof FormValues;

function isField(key: unknown): key is FieldName {
  return key === 'roleId' || key === 'topic' || key === 'content';
}

const ERROR_KEY: Record<FieldName, 'role' | 'topic' | 'content'> = {
  roleId: 'role',
  topic: 'topic',
  content: 'content',
};

interface NoteFormProps {
  guildId: string;
  /** The note being edited; `undefined` adds a new one. */
  editing: NoteView | undefined;
  /** Every note now on the page, to refuse a new note that would silently replace one. */
  existing: readonly NoteView[];
  onSaved: () => void;
}

export function NoteForm({ guildId, editing, existing, onSaved }: NoteFormProps) {
  const t = useTranslations('web-note');
  const tCommon = useTranslations('web-common');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<FormValues>();
  const save = useApiMutation((note: Parameters<typeof saveNote>[2]) =>
    saveNote(guildId, editing === undefined ? 'create' : 'update', note),
  );

  const submit = async (values: FormValues) => {
    const parsed = NoteUpsertSchema.safeParse(values);
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.flatMap((issue) => {
          const field = issue.path[0];
          return isField(field)
            ? [{ name: field, errors: [t(`validation.${ERROR_KEY[field]}`)] }]
            : [];
        }),
      );
      return;
    }
    const note = parsed.data;
    if (
      editing === undefined &&
      existing.some((other) => other.roleId === note.roleId && other.topic === note.topic)
    ) {
      form.setFields([{ name: 'topic', errors: [t('validation.exists')] }]);
      return;
    }
    const outcome = await save.run(note);
    if (outcome === undefined) return;
    if (!outcome.ok) {
      // No readable answer: the note may have been saved, so re-read the page before a retry.
      if (outcome.error.status === 0) router.refresh();
      return;
    }
    void message.success(t('form.saved'));
    router.refresh();
    onSaved();
  };

  const required = [{ required: true, message: t('validation.required') }];

  return (
    <Form<FormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{
        roleId: editing?.roleId,
        topic: editing?.topic,
        content: editing?.content,
      }}
      onFinish={(values) => void submit(values)}
      disabled={save.pending}
    >
      {editing === undefined ? null : (
        <Form.Item>
          <Alert type="info" showIcon title={t('form.roleLocked')} />
        </Form.Item>
      )}
      <Form.Item name="roleId" label={t('form.role')} rules={required}>
        <RoleSelect guildId={guildId} disabled={editing !== undefined || save.pending} />
      </Form.Item>
      <Form.Item name="topic" label={t('form.topic')} rules={required}>
        <Input maxLength={NOTE_TOPIC_MAX_LENGTH} disabled={editing !== undefined || save.pending} />
      </Form.Item>
      <Form.Item name="content" label={t('form.content')} rules={required}>
        <Input.TextArea
          maxLength={NOTE_CONTENT_MAX_LENGTH}
          showCount
          autoSize={{ minRows: 5, maxRows: 14 }}
        />
      </Form.Item>
      {save.error === undefined ? null : (
        <Form.Item>
          <ErrorAlert error={save.error} />
        </Form.Item>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onSaved} disabled={save.pending}>
          {tCommon('cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={save.pending}>
          {t('form.save')}
        </Button>
      </div>
    </Form>
  );
}
