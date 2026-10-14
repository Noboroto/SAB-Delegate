import type { NoteView } from './note-schemas';

export interface NoteGroup {
  roleId: string;
  notes: NoteView[];
}

/**
 * One group per role, in the order `roleOrder` lists them (a role it does not
 * list goes last), and the topics of a group alphabetically.
 */
export function groupNotesByRole(
  notes: readonly NoteView[],
  roleOrder: readonly string[],
): NoteGroup[] {
  const groups = new Map<string, NoteView[]>();
  for (const note of notes) {
    const group = groups.get(note.roleId);
    if (group === undefined) groups.set(note.roleId, [note]);
    else group.push(note);
  }
  const rank = (roleId: string) => {
    const index = roleOrder.indexOf(roleId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([roleId, members]) => ({
      roleId,
      notes: [...members].sort((a, b) => a.topic.localeCompare(b.topic)),
    }));
}
