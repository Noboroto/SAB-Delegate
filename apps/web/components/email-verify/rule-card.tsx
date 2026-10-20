'use client';

import { useState } from 'react';
import { Alert, Button, Card, Input, Popconfirm, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { ACCESS_CONDITION_TEXT_MAX, ROLES_MAX } from '@sab/shared';
import { RoleSelect } from '@/components/forms/role-select';
import { ActionRow } from '@/components/ui/action-row';
import {
  resolveDraft,
  toBuilderMode,
  toTextMode,
  type DraftError,
  type RuleDraft,
} from '@/lib/email-verify/rule-draft';
import { ConditionBuilder } from './condition-builder';

interface RuleCardProps {
  guildId: string;
  draft: RuleDraft;
  /** 1-based position, as the person counts rules. */
  index: number;
  count: number;
  listNames: readonly string[];
  /** Shows the builder's own mistakes too; set once a save was tried. */
  showErrors: boolean;
  disabled: boolean;
  onChange: (draft: RuleDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/** Why a draft cannot be saved yet, as one sentence; the text form says where it went wrong. */
function ErrorText({ error }: { error: DraftError }) {
  const t = useTranslations('web-email-verify.rules');
  if (error.kind === 'roles') return t('rolesTooMany', { max: ROLES_MAX });
  if (error.kind === 'text') {
    return t('textInvalid', { reason: t(`errors.${error.code}`), position: error.position + 1 });
  }
  return t('builderInvalid', { reason: t(`errors.${error.issue}`) });
}

/** One access rule: its condition (builder or text) and the roles it grants. */
export function RuleCard({
  guildId,
  draft,
  index,
  count,
  listNames,
  showErrors,
  disabled,
  onChange,
  onMove,
  onRemove,
}: RuleCardProps) {
  const t = useTranslations('web-email-verify.rules');
  // Why the text could not become a builder; cleared by the next edit.
  const [switchError, setSwitchError] = useState<DraftError | undefined>(undefined);

  const resolved = resolveDraft(draft);
  const error = resolved.ok ? undefined : resolved.error;
  const shownError =
    switchError ??
    (error !== undefined &&
    (showErrors || error.kind === 'roles' || (draft.mode === 'text' && draft.text.trim() !== ''))
      ? error
      : undefined);

  const toggleMode = () => {
    if (draft.mode === 'builder') {
      setSwitchError(undefined);
      onChange(toTextMode(draft));
      return;
    }
    const next = toBuilderMode(draft);
    if (next.ok) {
      setSwitchError(undefined);
      onChange(next.draft);
    } else {
      setSwitchError(next.error);
    }
  };

  const fieldId = `rule-${draft.key}`;

  return (
    <Card
      size="small"
      title={t('rule', { index })}
      extra={
        <ActionRow>
          <Button
            icon={<ArrowUpOutlined />}
            aria-label={t('moveUp', { index })}
            disabled={disabled || index === 1}
            onClick={() => onMove(-1)}
          />
          <Button
            icon={<ArrowDownOutlined />}
            aria-label={t('moveDown', { index })}
            disabled={disabled || index === count}
            onClick={() => onMove(1)}
          />
          <Popconfirm
            title={t('removeConfirm')}
            okText={t('remove')}
            okButtonProps={{ danger: true }}
            onConfirm={onRemove}
            disabled={disabled}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              aria-label={`${t('remove')} ${index}`}
              disabled={disabled}
            />
          </Popconfirm>
        </ActionRow>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <ActionRow style={{ justifyContent: 'space-between' }}>
            <Typography.Text strong id={`${fieldId}-condition`}>
              {t('condition')}
            </Typography.Text>
            <Button type="link" onClick={toggleMode} disabled={disabled}>
              {draft.mode === 'builder' ? t('editAsText') : t('editAsBuilder')}
            </Button>
          </ActionRow>
          {draft.mode === 'builder' ? (
            <ConditionBuilder
              query={draft.query}
              listNames={listNames}
              disabled={disabled}
              onChange={(query) => {
                setSwitchError(undefined);
                onChange({ ...draft, query });
              }}
            />
          ) : (
            <Input.TextArea
              aria-labelledby={`${fieldId}-condition`}
              aria-invalid={shownError !== undefined}
              status={shownError === undefined ? undefined : 'error'}
              value={draft.text}
              placeholder={t('textPlaceholder')}
              maxLength={ACCESS_CONDITION_TEXT_MAX}
              autoSize={{ minRows: 2, maxRows: 8 }}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => {
                setSwitchError(undefined);
                onChange({ ...draft, text: event.target.value });
              }}
            />
          )}
          {shownError === undefined ? null : (
            <Alert type="error" showIcon title={<ErrorText error={shownError} />} />
          )}
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor={`${fieldId}-roles`}>
            <Typography.Text strong>{t('roles')}</Typography.Text>
          </label>
          <RoleSelect
            id={`${fieldId}-roles`}
            guildId={guildId}
            multiple
            maxCount={ROLES_MAX}
            hideManaged
            disabled={disabled}
            value={draft.roleIds}
            onChange={(roleIds) => onChange({ ...draft, roleIds })}
          />
          <Typography.Text type="secondary">{t('rolesHelp', { max: ROLES_MAX })}</Typography.Text>
        </div>
      </div>
    </Card>
  );
}
