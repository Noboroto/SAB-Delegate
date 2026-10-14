import { describe, expect, it } from 'vitest';
import { groupNotesByRole } from './group-notes';
import type { NoteView } from './note-schemas';

const note = (roleId: string, topic: string): NoteView => ({
  roleId,
  topic,
  content: 'text',
  updatedAt: new Date(0),
});

describe('groupNotesByRole', () => {
  it('orders groups by the given role order and keeps unlisted roles last', () => {
    const groups = groupNotesByRole([note('c', 'x'), note('a', 'x'), note('b', 'x')], ['a', 'b']);
    expect(groups.map((group) => group.roleId)).toEqual(['a', 'b', 'c']);
  });

  it('sorts the topics inside a group and does not change the input', () => {
    const input = [note('a', 'Zeta'), note('a', 'Alpha')];
    const [group] = groupNotesByRole(input, []);
    expect(group?.notes.map((entry) => entry.topic)).toEqual(['Alpha', 'Zeta']);
    expect(input.map((entry) => entry.topic)).toEqual(['Zeta', 'Alpha']);
  });

  it('returns no groups for no notes', () => {
    expect(groupNotesByRole([], ['a'])).toEqual([]);
  });
});
