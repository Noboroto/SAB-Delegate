import {
  CopyMessageSchema,
  CreateReactionPollSchema,
  MessageContentSchema,
  MessageTargetSchema,
  ReactToMessageSchema,
  SendMessageSchema,
  parseMessageRef,
  type CopyMessage,
  type CreateReactionPoll,
  type MessageRefFailure,
  type MessageTarget,
  type ReactToMessage,
  type SendMessage,
} from '@sab/shared';
import { ApiRequestError } from '@/lib/api/api-response';

/** A form's fields turned into the request the server takes, or "not yet": the submit stays off. */
export type Built<T> = { ok: true; value: T } | { ok: false };

const NOT_YET = { ok: false } as const;

/**
 * The request a form built. The action is disabled until the form builds one,
 * so reaching this without it is a click that raced a change; it fails like the
 * server's own validation error instead of sending something half-formed.
 */
export function requireBuilt<T>(request: Built<T>): T {
  if (!request.ok) throw new ApiRequestError(400, 'VALIDATION_FAILED');
  return request.value;
}

function built<T>(parsed: { success: true; data: T } | { success: false }): Built<T> {
  return parsed.success ? { ok: true, value: parsed.data } : NOT_YET;
}

export type RefReading =
  { ok: true; target: MessageTarget } | { ok: false; reason: MessageRefFailure };

/**
 * A message named by a "Copy Message Link" URL or a `channelId/messageId` pair.
 * A bare message id is refused because the page has no channel to read it in.
 */
export function readMessageRef(text: string | undefined): RefReading {
  const result = parseMessageRef(text ?? '');
  if (!result.ok) return result;
  return { ok: true, target: { channelId: result.channelId, messageId: result.messageId } };
}

/** `undefined` while the field is empty or fine; the failure to explain once something was typed. */
export function refProblem(text: string | undefined): MessageRefFailure | undefined {
  if ((text ?? '').trim() === '') return undefined;
  const reading = readMessageRef(text);
  return reading.ok ? undefined : reading.reason;
}

interface SendFields {
  channelId?: string | undefined;
  content?: string | undefined;
  replyTo?: string | undefined;
}

export function buildSend({ channelId, content, replyTo }: SendFields): Built<SendMessage> {
  const reply = (replyTo ?? '').trim() === '' ? undefined : readMessageRef(replyTo);
  if (reply?.ok === false) return NOT_YET;
  return built(
    SendMessageSchema.safeParse({
      channelId,
      content,
      ...(reply === undefined ? {} : { replyTo: reply.target }),
    }),
  );
}

interface CopyFields {
  source?: string | undefined;
  channelId?: string | undefined;
}

export function buildCopy({ source, channelId }: CopyFields): Built<CopyMessage> {
  const reading = readMessageRef(source);
  if (!reading.ok) return NOT_YET;
  return built(CopyMessageSchema.safeParse({ source: reading.target, channelId }));
}

interface ReactFields {
  target?: string | undefined;
  emoji?: string | undefined;
  pollChoices?: number | null | undefined;
}

export function buildReact({ target, emoji, pollChoices }: ReactFields): Built<ReactToMessage> {
  const reading = readMessageRef(target);
  if (!reading.ok) return NOT_YET;
  return built(
    ReactToMessageSchema.safeParse({
      target: reading.target,
      emoji,
      pollChoices: pollChoices ?? 0,
    }),
  );
}

export type PollTarget = 'new' | 'existing';

interface PollFields {
  mode: PollTarget;
  channelId?: string | undefined;
  message?: string | undefined;
  choices?: number | null | undefined;
}

export function buildPoll({
  mode,
  channelId,
  message,
  choices,
}: PollFields): Built<CreateReactionPoll> {
  if (mode === 'new') {
    return built(CreateReactionPollSchema.safeParse({ channelId, choices }));
  }
  const reading = readMessageRef(message);
  if (!reading.ok) return NOT_YET;
  return built(CreateReactionPollSchema.safeParse({ ...reading.target, choices }));
}

interface EditFields {
  message?: string | undefined;
  content?: string | undefined;
}

export function buildEdit({
  message,
  content,
}: EditFields): Built<{ target: MessageTarget; content: string }> {
  const reading = readMessageRef(message);
  if (!reading.ok) return NOT_YET;
  const text = MessageContentSchema.safeParse(content);
  const target = MessageTargetSchema.safeParse(reading.target);
  if (!text.success || !target.success) return NOT_YET;
  return { ok: true, value: { target: target.data, content: text.data } };
}
