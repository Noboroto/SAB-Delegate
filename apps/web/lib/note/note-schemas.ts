import { NoteSchema, z } from '@sab/shared';

/**
 * A note as it arrives over HTTP. The shared schema types `updatedAt` as a
 * `Date`, which JSON turns into text, so the web reads it back with coercion.
 */
export const NoteViewSchema = NoteSchema.extend({ updatedAt: z.coerce.date() });

export const NoteViewListSchema = z.array(NoteViewSchema);

export type NoteView = z.infer<typeof NoteViewSchema>;
