'use client';

import { Button, Input, Select } from 'antd';
import { useTranslations } from 'next-intl';
import type { ActionProps, ValueEditorProps, ValueSelectorProps } from 'react-querybuilder';
import { ACCESS_CONDITION_DEPTH_MAX } from '@sab/shared';

/*
 * The builder's controls in AntD, written here instead of taking
 * `@react-querybuilder/antd`: its ESM build imports `antd/es/...` and `dayjs`
 * for a date picker this builder never shows, which Node's own ESM loader (Next
 * server render, Vitest) cannot resolve and which adds a date picker to the
 * bundle. Every condition here is a select plus a text box or a select.
 */

/** One button look for every builder action; the title is the accessible name of the short label. */
export function BuilderAction(props: ActionProps) {
  return (
    <Button
      className={props.className}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={(event) => props.handleOnClick(event)}
    >
      {props.label}
    </Button>
  );
}

/** A group nested here would break the depth limit, so the button is not offered. */
export function AddGroupAction(props: ActionProps) {
  return props.level + 1 < ACCESS_CONDITION_DEPTH_MAX ? <BuilderAction {...props} /> : null;
}

interface Choice {
  name: string;
  label: string;
}

type ChoiceList = readonly (Choice | { options: readonly Choice[] })[];

/** The choices of an option list, with any option groups flattened. */
function choicesOf(list: ChoiceList | undefined): { value: string; label: string }[] {
  return (list ?? [])
    .flatMap((entry) => ('options' in entry ? entry.options : [entry]))
    .map((choice) => ({ value: choice.name, label: choice.label }));
}

/** The position of a condition as a person counts it: `2` is the second, `2.1` the first inside a group. */
const rowOf = (path: readonly number[]) => path.map((index) => index + 1).join('.');

/** A select whose accessible name says which condition or group it belongs to. */
function LabelledSelector({ label, ...props }: ValueSelectorProps & { label: string }) {
  return (
    <Select
      className={props.className}
      aria-label={label}
      disabled={props.disabled}
      value={props.value}
      options={choicesOf(props.options)}
      onChange={(next: string) => props.handleOnChange(next)}
    />
  );
}

/** Which field a condition looks at. */
export function FieldSelector(props: ValueSelectorProps) {
  const t = useTranslations('web-email-verify.rules.builder.aria');
  return <LabelledSelector {...props} label={t('field', { row: rowOf(props.path) })} />;
}

/** AND or OR of one group; the outermost group is the whole condition. */
export function CombinatorSelector(props: ValueSelectorProps) {
  const t = useTranslations('web-email-verify.rules.builder.aria');
  const label =
    props.path.length === 0 ? t('combinatorRoot') : t('combinator', { row: rowOf(props.path) });
  return <LabelledSelector {...props} label={label} />;
}

/** The value of one condition: a list name from a select, anything else typed. */
export function BuilderValueEditor(props: ValueEditorProps) {
  const t = useTranslations('web-email-verify.rules.builder.aria');
  const label = t('value', { row: rowOf(props.path) });
  const text = typeof props.value === 'string' ? props.value : '';
  const placeholder =
    typeof props.fieldData.placeholder === 'string' ? props.fieldData.placeholder : undefined;
  if (props.type === 'select') {
    return (
      <Select
        className={props.className}
        aria-label={label}
        disabled={props.disabled}
        value={text === '' ? undefined : text}
        placeholder={placeholder}
        options={choicesOf(props.values)}
        onChange={(next: string) => props.handleOnChange(next)}
      />
    );
  }
  return (
    <Input
      className={props.className}
      aria-label={label}
      disabled={props.disabled}
      value={text}
      placeholder={placeholder}
      maxLength={300}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => props.handleOnChange(event.target.value)}
    />
  );
}

// There is one operator, so the selector would only be noise.
export const NoOperatorSelector = () => null;
