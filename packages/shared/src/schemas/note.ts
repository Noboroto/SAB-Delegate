import { z } from 'zod';
import { NoteEntrySchema } from '../generated/zod/schemas/models/NoteEntry.schema.js';
import { SnowflakeSchema } from './snowflake.js';

/** An autocomplete choice carries the topic as its value, and Discord caps that at 100 characters. */
export const NOTE_TOPIC_MAX_LENGTH = 100;

/** The most a slash-command string option can carry. */
export const NOTE_CONTENT_MAX_LENGTH = 6000;

/**
 * Surrounding whitespace is dropped so a topic typed with a stray space and
 * the one picked from autocomplete are the same key. Case is kept: topics are
 * case-sensitive.
 */
export const NoteTopicSchema = z.string().trim().min(1).max(NOTE_TOPIC_MAX_LENGTH);

/** Stored as written (line breaks and indentation matter) but never blank. */
export const NoteContentSchema = z
  .string()
  .max(NOTE_CONTENT_MAX_LENGTH)
  .refine((content) => content.trim() !== '', { message: 'content must not be blank' });

/** A note as the API and the commands see it; the row's internal keys stay inside. */
export const NoteSchema = NoteEntrySchema.pick({
  roleId: true,
  topic: true,
  content: true,
  updatedAt: true,
}).extend({
  roleId: SnowflakeSchema,
  topic: NoteTopicSchema,
  content: NoteContentSchema,
});

export type Note = z.infer<typeof NoteSchema>;

/** Which note: a role plus a topic, within one server. */
export const NoteKeySchema = NoteSchema.pick({ roleId: true, topic: true });

export type NoteKey = z.infer<typeof NoteKeySchema>;

/** Saving a note replaces the content of an existing topic. */
export const NoteUpsertSchema = NoteSchema.pick({ roleId: true, topic: true, content: true });

export type NoteUpsert = z.infer<typeof NoteUpsertSchema>;

/** What a dry-run of a save reports: whether the note would be created or its content replaced. */
export const NoteUpsertPlanSchema = z.object({
  action: z.enum(['CREATE', 'REPLACE']),
  roleId: SnowflakeSchema,
  topic: z.string(),
});

export type NoteUpsertPlan = z.infer<typeof NoteUpsertPlanSchema>;

/** What a dry-run of a removal reports: how many notes would go, and which. */
export const NoteRemovePlanSchema = z.object({
  count: z.number().int().min(0),
  sample: z.array(NoteKeySchema),
});

export type NoteRemovePlan = z.infer<typeof NoteRemovePlanSchema>;

/** What a removal did; `count` is 0 when the note did not exist. */
export const NoteRemoveResultSchema = z.object({
  count: z.number().int().min(0),
});

export type NoteRemoveResult = z.infer<typeof NoteRemoveResultSchema>;
