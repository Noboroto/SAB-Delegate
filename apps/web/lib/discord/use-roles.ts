'use client';

import { LookupRoleSchema, z, type LookupRole } from '@sab/shared';
import { useLookup, type LookupState } from './use-lookup';
import { guildApiPath } from '@/lib/guild-path';

const RolesSchema = z.array(LookupRoleSchema);

/** The roles of a server, highest first. */
export function useRoles(guildId: string): LookupState<LookupRole[]> {
  return useLookup(guildApiPath(guildId, 'discord', 'roles'), RolesSchema);
}
