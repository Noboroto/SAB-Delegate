'use client';

import { Fragment, useState } from 'react';
import { App, Button, Modal, Pagination, Tag, Typography, theme } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BIRTHDAY_NAME_PLACEHOLDER, BIRTHDAY_WISHES_MAX, type BirthdayWishView } from '@sab/shared';
import { useConfirmLeave } from '@/components/forms/unsaved-guard';
import { ActionRow } from '@/components/ui/action-row';
import { PageState } from '@/components/ui/page-state';
import { useApiErrorMessage, useApiMutation } from '@/lib/api/mutations';
import { removeBirthdayWish } from '@/lib/birthday/birthday-wish-api';
import { BirthdayWishForm } from './birthday-wish-form';

interface BirthdayWishesProps {
  guildId: string;
  wishes: readonly BirthdayWishView[];
}

type Editor = { wish: BirthdayWishView | undefined } | undefined;

const PAGE_SIZE = 10;

/** The wish as written (line breaks kept, never markup), with each name placeholder marked. */
function WishText({ text }: { text: string }) {
  const { token } = theme.useToken();
  const parts = text.split(BIRTHDAY_NAME_PLACEHOLDER);
  return (
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index === 0 ? null : (
            <mark
              style={{
                background: token.colorPrimaryBg,
                color: token.colorPrimary,
                borderRadius: token.borderRadiusSM,
                padding: '0 var(--space-1)',
              }}
            >
              {BIRTHDAY_NAME_PLACEHOLDER}
            </mark>
          )}
          {part}
        </Fragment>
      ))}
    </div>
  );
}

interface WishRowProps {
  guildId: string;
  wish: BirthdayWishView;
  /** Position in the whole list, for the buttons' accessible names. */
  index: number;
  onEdit: (wish: BirthdayWishView) => void;
}

function WishRow({ guildId, wish, index, onEdit }: WishRowProps) {
  const t = useTranslations('web-birthday.wishes');
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();
  const messageOf = useApiErrorMessage();
  const remove = useApiMutation(() => removeBirthdayWish(guildId, wish.id));

  const confirmRemove = () => {
    modal.confirm({
      title: t('remove.modalTitle'),
      content: <WishText text={wish.text} />,
      okText: t('remove.confirm'),
      okButtonProps: { danger: true },
      cancelText: t('remove.cancel'),
      async onOk() {
        const outcome = await remove.run(undefined);
        if (outcome === undefined) return;
        if (outcome.ok) void message.success(t('remove.done'));
        else void message.error(messageOf(outcome.error));
        // A failed delete may be a wish that is already gone; either way the list is re-read.
        router.refresh();
      },
    });
  };

  return (
    <li
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-2) var(--space-4)',
        alignItems: 'flex-start',
        padding: 'var(--space-3) 0',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <div style={{ flex: '1 1 20rem', minWidth: 0 }}>
        <WishText text={wish.text} />
        {wish.used ? (
          <Tag style={{ marginTop: 'var(--space-2)', marginInlineEnd: 0 }}>{t('used')}</Tag>
        ) : null}
      </div>
      <ActionRow>
        <Button aria-label={t('edit.label', { index })} onClick={() => onEdit(wish)}>
          {t('edit.button')}
        </Button>
        <Button danger aria-label={t('remove.label', { index })} onClick={confirmRemove}>
          {t('remove.button')}
        </Button>
      </ActionRow>
    </li>
  );
}

export function BirthdayWishes({ guildId, wishes }: BirthdayWishesProps) {
  const t = useTranslations('web-birthday.wishes');
  const confirmLeave = useConfirmLeave();
  const [editor, setEditor] = useState<Editor>(undefined);
  const [requestedPage, setRequestedPage] = useState(1);

  const atLimit = wishes.length >= BIRTHDAY_WISHES_MAX;
  // Deleting the last wish of the last page must not leave an empty page behind.
  const lastPage = Math.max(1, Math.ceil(wishes.length / PAGE_SIZE));
  const page = Math.min(requestedPage, lastPage);
  const first = (page - 1) * PAGE_SIZE;
  const openAdd = () => setEditor({ wish: undefined });

  return (
    <>
      <Typography.Paragraph type="secondary">
        {t('help', { placeholder: BIRTHDAY_NAME_PLACEHOLDER })}
      </Typography.Paragraph>
      {wishes.length === 0 ? (
        <PageState
          status="info"
          headingLevel={2}
          title={t('empty.title')}
          body={t('empty.body')}
          action={{ label: t('add'), onClick: openAdd }}
        />
      ) : (
        <>
          <ActionRow style={{ marginBottom: 'var(--space-3)' }}>
            <Button type="primary" disabled={atLimit} onClick={openAdd}>
              {t('add')}
            </Button>
            <Typography.Text type="secondary">
              {atLimit
                ? t('limitReached', { max: BIRTHDAY_WISHES_MAX })
                : t('count', { count: wishes.length, max: BIRTHDAY_WISHES_MAX })}
            </Typography.Text>
          </ActionRow>
          <ol aria-label={t('label')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {wishes.slice(first, first + PAGE_SIZE).map((wish, offset) => (
              <WishRow
                key={wish.id}
                guildId={guildId}
                wish={wish}
                index={first + offset + 1}
                onEdit={(target) => setEditor({ wish: target })}
              />
            ))}
          </ol>
          <Pagination
            style={{ marginTop: 'var(--space-3)' }}
            current={page}
            pageSize={PAGE_SIZE}
            total={wishes.length}
            hideOnSinglePage
            showSizeChanger={false}
            onChange={setRequestedPage}
          />
        </>
      )}
      <Modal
        open={editor !== undefined}
        title={editor?.wish === undefined ? t('form.addTitle') : t('form.editTitle')}
        footer={null}
        // Several lines of text are one stray click from lost; only Cancel, the X or Esc close it, and those ask first.
        mask={{ closable: false }}
        onCancel={() => confirmLeave(() => setEditor(undefined))}
        destroyOnHidden
      >
        <BirthdayWishForm
          guildId={guildId}
          editing={editor?.wish}
          onSaved={() => {
            // A new wish goes to the end of the list: show the page it lands on.
            if (editor?.wish === undefined) setRequestedPage(Number.MAX_SAFE_INTEGER);
            setEditor(undefined);
          }}
          onClose={() => setEditor(undefined)}
        />
      </Modal>
    </>
  );
}
