'use client';

import { useId, type MouseEvent, type ReactNode } from 'react';
import { Typography, type FormInstance } from 'antd';
import { useTranslations } from 'next-intl';
import { ActionRow } from '@/components/ui/action-row';

interface ValidatedActionProps {
  /** The form the action reads; its fields show their own message when the action is refused. */
  form: FormInstance;
  /** Whether the form as it stands yields a request. */
  valid: boolean;
  children: ReactNode;
}

/**
 * An action that opens a preview from form values. While the form is not
 * valid the button stays clickable: a click marks the fields that are missing
 * (instead of a greyed-out button nobody can explain) and never reaches the
 * action. The hint sits in the same row as the button.
 */
export function ValidatedAction({ form, valid, children }: ValidatedActionProps) {
  const t = useTranslations('web-tools');
  const hintId = useId();

  const refuse = (event: MouseEvent<HTMLElement>) => {
    if (valid) return;
    // A modal opened by the action renders in a portal: React still bubbles its clicks here,
    // but they are not clicks on the button and must reach the modal's own buttons.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    event.stopPropagation();
    void form.validateFields().catch(() => undefined);
  };

  return (
    <ActionRow>
      {/* `contents` keeps the button a direct flex item of the row; the capture handler runs before the button's own. */}
      <div
        role="group"
        aria-disabled={valid ? undefined : true}
        aria-describedby={valid ? undefined : hintId}
        onClickCapture={refuse}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {valid ? null : (
        <Typography.Text id={hintId} type="secondary">
          {t('common.fillRequired')}
        </Typography.Text>
      )}
    </ActionRow>
  );
}
