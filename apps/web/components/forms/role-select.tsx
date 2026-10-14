'use client';

import { useMemo } from 'react';
import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import { useRoles } from '@/lib/discord/use-roles';
import { LookupNotFound } from './lookup-not-found';
import { selectValueProps, type PickerProps } from './picker-value';

type RoleSelectProps = PickerProps & {
  /** Hides roles an integration owns (bot roles, boosters); people cannot be given those. */
  hideManaged?: boolean;
};

/** A searchable list of the server's roles, highest first. */
export function RoleSelect({
  hideManaged = false,
  guildId,
  placeholder,
  ...rest
}: RoleSelectProps) {
  const t = useTranslations('web-common');
  const roles = useRoles(guildId);
  const options = useMemo(
    () =>
      (roles.data ?? [])
        .filter((role) => !hideManaged || !role.managed)
        .map((role) => ({ value: role.id, label: role.name })),
    [roles.data, hideManaged],
  );
  const value = selectValueProps(rest);

  return (
    <Select
      id={rest.id}
      aria-label={rest['aria-label']}
      disabled={rest.disabled}
      allowClear={rest.allowClear}
      mode={value.mode}
      value={value.value}
      onChange={value.onChange}
      options={options}
      loading={roles.loading}
      status={roles.error === undefined ? undefined : 'error'}
      placeholder={placeholder ?? t('picker.rolePlaceholder')}
      showSearch={{ optionFilterProp: 'label' }}
      notFoundContent={<LookupNotFound state={roles} />}
      style={{ width: '100%' }}
    />
  );
}
