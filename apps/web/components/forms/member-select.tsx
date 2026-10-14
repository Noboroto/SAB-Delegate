'use client';

import { useMemo, useState } from 'react';
import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import { useMembers } from '@/lib/discord/use-members';
import { LookupNotFound } from './lookup-not-found';
import { selectValueProps, type PickerProps } from './picker-value';

/**
 * Finds people by what is typed: the server searches Discord for names that
 * start with it, so the list is never "all members". Options keep the picked
 * people visible after the search text changes.
 */
export function MemberSelect({ guildId, placeholder, ...rest }: PickerProps) {
  const t = useTranslations('web-common');
  const [query, setQuery] = useState('');
  const members = useMembers(guildId, query);
  const [remembered, setRemembered] = useState<Record<string, string>>({});

  const options = useMemo(() => {
    const found = (members.data ?? []).map((member) => ({
      value: member.id,
      label: `${member.displayName} (@${member.username})${member.bot ? ` · ${t('picker.memberBot')}` : ''}`,
    }));
    const ids = new Set(found.map((option) => option.value));
    const picked = Object.entries(remembered)
      .filter(([id]) => !ids.has(id))
      .map(([value, label]) => ({ value, label }));
    return [...found, ...picked];
  }, [members.data, remembered, t]);

  const value = selectValueProps(rest);
  const remember = (ids: string[]) =>
    setRemembered(
      Object.fromEntries(
        ids.flatMap((id) => {
          const label = options.find((option) => option.value === id)?.label;
          return label === undefined ? [] : [[id, label]];
        }),
      ),
    );
  const onChange = (next: string | string[] | undefined) => {
    remember(next === undefined ? [] : Array.isArray(next) ? next : [next]);
    value.onChange(next);
  };

  return (
    <Select
      id={rest.id}
      aria-label={rest['aria-label']}
      disabled={rest.disabled}
      allowClear={rest.allowClear}
      mode={value.mode}
      value={value.value}
      onChange={onChange}
      options={options}
      loading={members.loading}
      status={members.error === undefined ? undefined : 'error'}
      placeholder={placeholder ?? t('picker.memberPlaceholder')}
      // The server already filtered by what was typed; filtering again here
      // would hide a match the server found by nickname.
      showSearch={{ filterOption: false, onSearch: setQuery }}
      notFoundContent={
        query.trim() === '' ? (
          <div style={{ padding: 8 }}>{t('picker.memberHint')}</div>
        ) : (
          <LookupNotFound state={members} />
        )
      }
      style={{ width: '100%' }}
    />
  );
}
