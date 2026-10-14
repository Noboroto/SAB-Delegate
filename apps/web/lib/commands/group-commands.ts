import type { CommandCatalogEntry } from '@sab/shared';

export interface CommandGroups {
  /** Commands Discord lets every member use by default. */
  everyone: CommandCatalogEntry[];
  /** Commands that need a permission by default. */
  restricted: CommandCatalogEntry[];
}

/** Splits by who may use the command, keeping the catalog's own order inside each group. */
export function groupCommands(entries: readonly CommandCatalogEntry[]): CommandGroups {
  const groups: CommandGroups = { everyone: [], restricted: [] };
  for (const entry of entries) {
    (entry.defaultMemberPermissions === null ? groups.everyone : groups.restricted).push(entry);
  }
  return groups;
}
