'use client';

import { useMemo } from 'react';
import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import type { LookupChannel } from '@sab/shared';
import { CHANNEL_TYPE, useChannels } from '@/lib/discord/use-channels';
import { LookupNotFound } from './lookup-not-found';
import { selectValueProps, type PickerProps } from './picker-value';

type ChannelSelectProps = PickerProps & {
  /** Discord channel types to offer; all non-thread channels when omitted (`TEXT_CHANNEL_TYPES` for "where can I post"). */
  types?: readonly number[];
};

interface ChannelOption {
  value: string;
  label: string;
}

function labelOf(channel: LookupChannel): string {
  return channel.type === CHANNEL_TYPE.text || channel.type === CHANNEL_TYPE.announcement
    ? `# ${channel.name}`
    : channel.name;
}

/** Channels grouped under their category, in Discord's order; a channel with no category comes first. */
function groupOptions(channels: readonly LookupChannel[], types: readonly number[] | undefined) {
  const categoryNames = new Map(
    channels.filter((c) => c.type === CHANNEL_TYPE.category).map((c) => [c.id, c.name]),
  );
  const groups = new Map<string | null, ChannelOption[]>();
  for (const channel of channels) {
    if (types !== undefined && !types.includes(channel.type)) continue;
    const key =
      channel.parentId !== null && categoryNames.has(channel.parentId) ? channel.parentId : null;
    groups.set(key, [...(groups.get(key) ?? []), { value: channel.id, label: labelOf(channel) }]);
  }
  const ungrouped = groups.get(null) ?? [];
  const grouped = [...groups.entries()]
    .filter(([key]) => key !== null)
    .map(([key, options]) => ({ label: categoryNames.get(key ?? '') ?? '', options }));
  return [...ungrouped, ...grouped];
}

/** A searchable list of the server's channels, read from the server's own cache of Discord. */
export function ChannelSelect({ types, guildId, placeholder, ...rest }: ChannelSelectProps) {
  const t = useTranslations('web-common');
  const channels = useChannels(guildId);
  const options = useMemo(() => groupOptions(channels.data ?? [], types), [channels.data, types]);
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
      loading={channels.loading}
      status={channels.error === undefined ? undefined : 'error'}
      placeholder={placeholder ?? t('picker.channelPlaceholder')}
      showSearch={{ optionFilterProp: 'label' }}
      notFoundContent={<LookupNotFound state={channels} />}
      style={{ width: '100%' }}
    />
  );
}
