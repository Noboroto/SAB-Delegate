import { serverFetch } from '@/lib/api/server-fetch';
import { NoteViewListSchema } from './note-schemas';
import { guildApiPath } from '@/lib/guild-path';

/** Every note of the server; the page groups them, the server holds no ordering for them. */
export function getNotes(guildId: string) {
  return serverFetch(guildApiPath(guildId, 'notes'), { parser: NoteViewListSchema });
}
