import { CHANNEL_TYPE } from '@/lib/discord/use-channels';

/** Channels that can hold threads. */
export const THREAD_PARENT_TYPES: readonly number[] = [
  CHANNEL_TYPE.text,
  CHANNEL_TYPE.announcement,
  CHANNEL_TYPE.forum,
];

/** Discord offers private threads in text channels only. */
export const PRIVATE_THREAD_PARENT_TYPES: readonly number[] = [CHANNEL_TYPE.text];
