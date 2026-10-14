import { parseMessageRef } from '@sab/shared';

/** What every Zod schema from `@sab/shared` offers; the web never imports Zod itself. */
interface RequestSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

/**
 * The request the shared schema accepts for what the form holds, or
 * `undefined` when it rejects it. The schema is the one the server checks
 * with, so a request built here is not turned away for its shape.
 */
export function buildRequest<T>(schema: RequestSchema<T>, raw: unknown): T | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** A blank optional field is "not given", never an empty string the schema would refuse. */
export function blankToUndefined(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

interface MessageRef {
  channelId: string;
  messageId: string;
}

/**
 * Reads a pasted "Copy Message Link" (or `channel/message`). A bare message id
 * is read in `channelId` when the form has one.
 */
export function readMessageRef(
  text: string | undefined,
  channelId?: string | null,
): MessageRef | undefined {
  const parsed = parseMessageRef(
    text ?? '',
    channelId === undefined || channelId === null ? {} : { channelId },
  );
  return parsed.ok ? { channelId: parsed.channelId, messageId: parsed.messageId } : undefined;
}
