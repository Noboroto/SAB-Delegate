'use client';

import { useMemo } from 'react';
import { QueryBuilder } from 'react-querybuilder';
import type {
  Field,
  FullCombinator,
  FullOperator,
  RuleGroupType,
  Translations,
} from 'react-querybuilder';
import { useTranslations } from 'next-intl';
import {
  AddGroupAction,
  BuilderAction,
  BuilderValueEditor,
  CombinatorSelector,
  FieldSelector,
  NoOperatorSelector,
} from './condition-builder-controls';
import 'react-querybuilder/dist/query-builder.css';
import './condition-builder.css';

const OPERATORS: FullOperator[] = [{ name: '=', value: '=', label: '=' }];

const CONTROL_ELEMENTS = {
  addRuleAction: BuilderAction,
  addGroupAction: AddGroupAction,
  removeRuleAction: BuilderAction,
  removeGroupAction: BuilderAction,
  operatorSelector: NoOperatorSelector,
  fieldSelector: FieldSelector,
  combinatorSelector: CombinatorSelector,
  valueEditor: BuilderValueEditor,
};

interface ConditionBuilderProps {
  query: RuleGroupType;
  onChange: (query: RuleGroupType) => void;
  /** Names of the server's lists, offered as the values of a list condition. */
  listNames: readonly string[];
  disabled?: boolean;
}

/** The AND/OR condition tree of one rule, edited with react-querybuilder in AntD controls. */
export function ConditionBuilder({ query, onChange, listNames, disabled }: ConditionBuilderProps) {
  const t = useTranslations('web-email-verify.rules.builder');

  const fields = useMemo<Field[]>(
    () => [
      { name: 'domain', label: t('fields.domain'), placeholder: '*.edu', operators: OPERATORS },
      {
        name: 'email',
        label: t('fields.email'),
        placeholder: '*@hcmus.edu.vn',
        operators: OPERATORS,
      },
      {
        name: 'list',
        label: t('fields.list'),
        operators: OPERATORS,
        valueEditorType: 'select',
        values: listNames.map((name) => ({ name, label: name })),
        placeholder: t('listPlaceholder'),
      },
      {
        name: 'invite',
        label: t('fields.invite'),
        placeholder: 'discord.gg/abc123',
        operators: OPERATORS,
      },
    ],
    [t, listNames],
  );

  const combinators = useMemo<FullCombinator[]>(
    () => [
      { name: 'and', value: 'and', label: t('and') },
      { name: 'or', value: 'or', label: t('or') },
    ],
    [t],
  );

  const translations = useMemo<Partial<Translations>>(
    () => ({
      addRule: { label: t('addCondition'), title: t('addCondition') },
      addGroup: { label: t('addGroup'), title: t('addGroup') },
      removeRule: { label: '×', title: t('removeCondition') },
      removeGroup: { label: '×', title: t('removeGroup') },
    }),
    [t],
  );

  return (
    <div className="ev-builder">
      <QueryBuilder
        fields={fields}
        operators={OPERATORS}
        combinators={combinators}
        query={query}
        onQueryChange={onChange}
        controlElements={CONTROL_ELEMENTS}
        translations={translations}
        disabled={disabled}
        addRuleToNewGroups
      />
    </div>
  );
}
