'use client';

import { useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ACCESS_RULES_MAX,
  type AccessRulesView,
  type EmailBlocklist,
  type EmailListSummary,
  type EmailVerifyConfig,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { saveEmailRules } from '@/lib/email-verify/email-verify-api';
import {
  draftFromRule,
  newDraft,
  resolveDraft,
  type RuleDraft,
} from '@/lib/email-verify/rule-draft';
import { RuleCard } from './rule-card';
import { RuleTester } from './rule-tester';
import { useReportUnsaved } from './unsaved-guard';

interface RulesEditorProps {
  guildId: string;
  view: AccessRulesView;
  lists: readonly EmailListSummary[];
  blocklist: EmailBlocklist;
  config: Pick<EmailVerifyConfig, 'defaultRoleIds'>;
}

/** What saving would send, as text, so "has the person changed anything" ignores builder ids. */
function signatureOf(drafts: readonly RuleDraft[]): string {
  return JSON.stringify(
    drafts.map((draft) => {
      const resolved = resolveDraft(draft);
      return resolved.ok
        ? resolved.rule
        : {
            invalid: draft.mode === 'text' ? draft.text : draft.query,
            roleIds: draft.roleIds,
          };
    }),
  );
}

/** The whole rule set of a server: edit, add, reorder and remove rules, then one save for all. */
export function RulesEditor({ guildId, view, lists, blocklist, config }: RulesEditorProps) {
  const t = useTranslations('web-email-verify.rules');
  const { message } = App.useApp();
  const router = useRouter();
  const nextKey = useRef(0);
  const takeKey = () => nextKey.current++;

  const [drafts, setDrafts] = useState<RuleDraft[]>(() =>
    view.rules.map((rule) => draftFromRule(rule, takeKey())),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [savedSignature, setSavedSignature] = useState(() => signatureOf(drafts));
  const save = useApiMutation((rules: Parameters<typeof saveEmailRules>[1]) =>
    saveEmailRules(guildId, rules),
  );

  const missingLists = useMemo(
    () => [...new Set(view.rules.flatMap((rule) => rule.missingLists))],
    [view.rules],
  );
  // The lists that exist, plus the missing ones a saved rule still names, so those stay visible in the pickers.
  const listNames = useMemo(
    () => [...new Set([...lists.map((list) => list.name), ...missingLists])],
    [lists, missingLists],
  );
  const dirty = signatureOf(drafts) !== savedSignature;
  useReportUnsaved(dirty);
  const full = drafts.length >= ACCESS_RULES_MAX;
  const hasErrors = drafts.some((draft) => !resolveDraft(draft).ok);

  const update = (key: number, next: RuleDraft) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? next : draft)));

  const move = (index: number, delta: -1 | 1) =>
    setDrafts((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(target, 0, item);
      return next;
    });

  const onSave = async () => {
    if (hasErrors) {
      setShowErrors(true);
      return;
    }
    const rules = drafts.flatMap((draft) => {
      const resolved = resolveDraft(draft);
      return resolved.ok ? [resolved.rule] : [];
    });
    const outcome = await save.run({ rules });
    if (outcome?.ok !== true) return;
    setShowErrors(false);
    setSavedSignature(signatureOf(drafts));
    void message.success(t('saved'));
    router.refresh();
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Card title={t('title')}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('intro')}
          </Typography.Paragraph>
          <Alert
            type="info"
            showIcon
            title={t('help.title')}
            description={
              <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <span>{t('help.fields')}</span>
                <span>{t('help.example')}</span>
                <span>{t('help.example2')}</span>
                <span>{t('help.precedence')}</span>
                <span>{t('help.invite')}</span>
              </div>
            }
          />
          {missingLists.length === 0 ? null : (
            <Alert
              type="warning"
              showIcon
              title={t('missingLists', { names: missingLists.join(', ') })}
            />
          )}
          {drafts.length === 0 ? (
            <Typography.Text type="secondary">{t('empty')}</Typography.Text>
          ) : (
            drafts.map((draft, index) => (
              <RuleCard
                key={draft.key}
                guildId={guildId}
                draft={draft}
                index={index + 1}
                count={drafts.length}
                listNames={listNames}
                showErrors={showErrors}
                disabled={save.pending}
                onChange={(next) => update(draft.key, next)}
                onMove={(delta) => move(index, delta)}
                onRemove={() => setDrafts((current) => current.filter((d) => d.key !== draft.key))}
              />
            ))
          )}
          {showErrors && hasErrors ? <Alert type="error" showIcon title={t('fixErrors')} /> : null}
          {save.error === undefined ? null : <ErrorAlert error={save.error} />}
          {dirty && !save.pending ? (
            <Typography.Text type="secondary">{t('unsavedChanges')}</Typography.Text>
          ) : null}
          <ActionRow>
            <Button
              type={drafts.length === 0 ? 'primary' : 'default'}
              disabled={full || save.pending}
              onClick={() => setDrafts((current) => [...current, newDraft(takeKey())])}
            >
              {t('add')}
            </Button>
            <Button
              type={drafts.length === 0 ? 'default' : 'primary'}
              loading={save.pending}
              disabled={!dirty}
              onClick={() => void onSave()}
            >
              {t('save')}
            </Button>
            {full ? (
              <Typography.Text type="secondary">
                {t('full', { max: ACCESS_RULES_MAX })}
              </Typography.Text>
            ) : null}
          </ActionRow>
        </div>
      </Card>
      <RuleTester
        guildId={guildId}
        drafts={drafts}
        blockPatterns={blocklist.patterns}
        defaultRoleIds={config.defaultRoleIds}
      />
    </div>
  );
}
