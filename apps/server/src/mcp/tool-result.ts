import { HttpException, Logger } from '@nestjs/common';
import { ErrorCode, SnowflakeSchema, z } from '@sab/shared';
import { DiscordAPIError, HTTPError, RateLimitError } from 'discord.js';
import { ApiError, errorBody } from '../common/errors/http-error.js';
import { ServiceError } from '../common/errors/service-error.js';
import { isInfrastructureError } from '../common/guild-access/guild-access.service.js';
import { loadEnv } from '../config/env.js';
import { errorLabel } from '../prisma/pool-factory.js';

const logger = new Logger('McpToolResult');

/** Shape the MCP SDK expects back from a tool handler. */
const ToolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  isError: z.boolean().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/** Provider token for {@link McpTarget}. */
export const MCP_TARGET = Symbol('MCP_TARGET');

/**
 * Which deployment this endpoint belongs to, taken from the server's own
 * configuration and never from anything the caller sent, so an agent cannot be
 * told it is on staging while it writes to production.
 */
const McpTargetSchema = z.object({ host: z.string().min(1), env: z.string().min(1) });
export type McpTarget = z.infer<typeof McpTargetSchema>;

export function mcpTargetFromEnv(env: ReturnType<typeof loadEnv> = loadEnv()): McpTarget {
  // MCP is only mounted while APP_URL is set, so the empty branch is a
  // configuration the module refuses to start with; it still must not read as local.
  return McpTargetSchema.parse({
    host: env.APP_URL === undefined ? 'unknown-host' : new URL(env.APP_URL).host,
    env: env.APP_ENV,
  });
}

export const GuildRefSchema = z.object({ id: SnowflakeSchema, name: z.string() });
export type GuildRef = z.infer<typeof GuildRefSchema>;

/** One-line form of the target for prose a model reads before it acts. */
export function describeTarget(target: McpTarget, guild?: GuildRef | null): string {
  const where = `${target.host} [${target.env}]`;
  return guild === undefined || guild === null
    ? where
    : `${where}, server "${guild.name}" (${guild.id})`;
}

type UntrustedOptions = { readonly untrusted?: readonly string[] };
type ResultOptions = UntrustedOptions & {
  readonly target?: McpTarget;
  readonly guild?: GuildRef | null;
};

/**
 * Wraps the text at `segments` as `{untrusted:true,text}`. Arrays are
 * transparent and `*` matches every key of an object, so `items.content` and
 * `items.*.content` name the same field. Copies on the way: the service's own
 * object is never mutated.
 */
function wrapAt(node: unknown, segments: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((item: unknown) => wrapAt(item, segments));
  if (segments.length === 0) {
    return typeof node === 'string' ? { untrusted: true, text: node } : node;
  }
  if (node === null || typeof node !== 'object') return node;
  const [head, ...rest] = segments;
  const record = node as Record<string, unknown>;
  if (head === '*') {
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, wrapAt(item, rest)]),
    );
  }
  if (head === undefined || !(head in record)) return node;
  return { ...record, [head]: wrapAt(record[head], rest) };
}

/** Marks text written by Discord members, which an agent must read as data and not as instructions. */
export function markUntrusted(value: unknown, paths: readonly string[]): unknown {
  return paths.reduce<unknown>((current, path) => wrapAt(current, path.split('.')), value);
}

/**
 * Serialises a service payload for the model. It is deliberately NOT re-parsed:
 * the service already returns what its REST route returns, and a second schema
 * would be a copy that drifts. `untrusted` names the fields holding member-written text.
 */
export function ok(value: unknown, options: ResultOptions = {}): ToolResult {
  const data = options.untrusted === undefined ? value : markUntrusted(value, options.untrusted);
  const body =
    options.target === undefined
      ? data
      : {
          deployment: `${options.target.host} [${options.target.env}]`,
          ...(options.guild != null && { guild: options.guild }),
          data,
        };
  return ToolResultSchema.parse({
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) ?? 'null' }],
  });
}

function failure(text: string): ToolResult {
  return ToolResultSchema.parse({ content: [{ type: 'text', text }], isError: true });
}

function codeOfDiscordFailure(error: unknown): ErrorCode | undefined {
  if (error instanceof RateLimitError) return ErrorCode.RATE_LIMITED;
  if (error instanceof DiscordAPIError && error.status === 429) return ErrorCode.RATE_LIMITED;
  if (
    error instanceof DiscordAPIError ||
    error instanceof HTTPError ||
    isInfrastructureError(error)
  ) {
    return ErrorCode.DISCORD_API_ERROR;
  }
  return undefined;
}

/** The catalog's wording and the public code (a missing bot reads exactly like a server the person may not manage). */
const line = (code: ErrorCode, params?: ConstructorParameters<typeof ServiceError>[1]): string => {
  const body = errorBody(code, params);
  return `${body.message} (${body.code})`;
};

/**
 * A tool failure as text. Tool calls never pass through the HTTP exception
 * filter, so the same rule is applied here: only the catalog's wording for a
 * known code is shown. Anything else gets the generic internal message, the
 * real error goes to the server log, and the arguments are never logged.
 * A `ZodError` is the one echo allowed: its issues are the caller's own input.
 */
export function describeError(error: unknown): string {
  if (error instanceof ServiceError) return line(error.code, error.params);
  if (error instanceof ApiError) return line(error.code);
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return line(
      status === 429
        ? ErrorCode.RATE_LIMITED
        : status < 500
          ? ErrorCode.VALIDATION_FAILED
          : ErrorCode.INTERNAL,
    );
  }
  if (error instanceof z.ZodError) {
    return `${line(ErrorCode.VALIDATION_FAILED)}\n${z.prettifyError(error)}`;
  }
  const discord = codeOfDiscordFailure(error);
  if (discord !== undefined) {
    logger.warn(`Discord call failed (${errorLabel(error)})`);
    return line(discord);
  }
  // Class and code only: a message can carry the very arguments or row values the log must not hold.
  logger.error(`Tool failed (${errorLabel(error)})`);
  return line(ErrorCode.INTERNAL);
}

/** Runs a tool body and turns a refused or failed call into a tool error that hides unknown messages. */
export async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    return failure(describeError(error));
  }
}

/**
 * The refusal of a confirm-class call without a valid token. It names the
 * deployment and the server because it is the one message sure to be read
 * before a write: an approval prompt shows only the tool name and arguments.
 */
export function refuseUnconfirmed(
  target: McpTarget,
  guild: GuildRef,
  effect: string,
  reason = 'no valid confirmToken was given',
): ToolResult {
  return failure(
    `Refused: ${reason}. This call would ${effect} on ${describeTarget(target, guild)}. Call it again with \`dryRun: true\` to preview and receive a confirmToken, then repeat the call with that token and the same arguments.`,
  );
}
