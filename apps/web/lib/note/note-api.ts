import {
  NoteRemovePlanSchema,
  NoteRemoveResultSchema,
  type NoteKey,
  type NoteRemovePlan,
  type NoteRemoveResult,
  type NoteUpsert,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { NoteViewSchema, type NoteView } from './note-schemas';
import { guildApiPath } from '@/lib/guild-path';

const notesPath = (guildId: string) => guildApiPath(guildId, 'notes');

/** Both routes save the same way on the server; the web uses POST for a new note and PATCH for an edit. */
export function saveNote(
  guildId: string,
  mode: 'create' | 'update',
  note: NoteUpsert,
): Promise<NoteView> {
  return apiFetch(notesPath(guildId), {
    method: mode === 'create' ? 'POST' : 'PATCH',
    body: note,
    parser: NoteViewSchema,
  });
}

function removeQuery(key: NoteKey, mode: 'dryRun' | 'confirm'): string {
  return new URLSearchParams({ roleId: key.roleId, topic: key.topic, [mode]: 'true' }).toString();
}

export function previewRemoveNote(guildId: string, key: NoteKey): Promise<NoteRemovePlan> {
  return apiFetch(`${notesPath(guildId)}?${removeQuery(key, 'dryRun')}`, {
    method: 'DELETE',
    parser: NoteRemovePlanSchema,
  });
}

export function removeNote(guildId: string, key: NoteKey): Promise<NoteRemoveResult> {
  return apiFetch(`${notesPath(guildId)}?${removeQuery(key, 'confirm')}`, {
    method: 'DELETE',
    parser: NoteRemoveResultSchema,
  });
}
