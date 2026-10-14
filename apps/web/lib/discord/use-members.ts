'use client';

import { useEffect, useState } from 'react';
import { LookupMemberSchema, SEARCH_MAX_LENGTH, z, type LookupMember } from '@sab/shared';
import { useLookup, type LookupState } from './use-lookup';
import { guildApiPath } from '@/lib/guild-path';

const MembersSchema = z.array(LookupMemberSchema);

/** Pause after the last keystroke before asking Discord; each search is a rate-limited call. */
export const MEMBER_SEARCH_DEBOUNCE_MS = 300;

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Members whose username or nickname starts with `query`, searched on the
 * server (a server can hold far more people than a list). An empty query asks
 * nothing; `loading` also covers the pause before the request goes out.
 */
export function useMembers(guildId: string, query: string): LookupState<LookupMember[]> {
  const wanted = query.trim().slice(0, SEARCH_MAX_LENGTH);
  const settled = useDebounced(wanted, MEMBER_SEARCH_DEBOUNCE_MS);
  const path =
    settled === ''
      ? null
      : `${guildApiPath(guildId, 'discord', 'members')}?q=${encodeURIComponent(settled)}`;
  const state = useLookup(path, MembersSchema);
  return { ...state, loading: state.loading || (wanted !== '' && wanted !== settled) };
}
