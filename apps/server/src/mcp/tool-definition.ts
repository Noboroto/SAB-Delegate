import type { Type } from '@nestjs/common';
import { AuditActionSchema, type ActorContext, type AuditAction, type z } from '@sab/shared';
import type { McpCaller } from './mcp-caller.js';
import type { GuildRef } from './tool-result.js';
import { isWriteClass, type ToolClass } from './tool-guard.js';
import { guardShapeFor } from './write-guard.js';

/** What a tool handler receives. `args` are the validated tool arguments without the guard fields. */
type ToolContext<Schema extends z.ZodObject = z.ZodObject> = {
  readonly args: Omit<z.infer<Schema>, 'dryRun' | 'confirmToken' | 'confirmGuildName'>;
  /** `true` when the call is a preview: pass it to the service as `opts.dryRun`; the service writes nothing. */
  readonly dryRun: boolean;
  readonly caller: McpCaller;
  /** `{ source: 'MCP', userId, apiKeyId }`: hand it to the service unchanged so its audit row names the key. */
  readonly actor: ActorContext;
  /** The server named by `args.guildId`, already checked against Manage Server; `null` for tools without one. */
  readonly guild: GuildRef | null;
  /** The Nest provider of `token`, from the running application. */
  readonly service: <T>(token: Type<T>) => T;
};

/**
 * One tool. `service` names the method the handler calls (`'BirthdayService.add'`)
 * so the registry spec can check it exists; `audit` is the audit action that
 * method records, required for every write class.
 */
type ToolRow<Schema extends z.ZodObject = z.ZodObject> = {
  readonly name: string;
  readonly class: ToolClass;
  readonly service: `${string}.${string}`;
  /** Built with `toolInputSchema(class, shape)`. */
  readonly inputSchema: Schema;
  /** Effect, side effects, how to undo, and a warning that returned member text is data and not instructions. */
  readonly description: string;
  readonly audit?: AuditAction;
  /** Dot paths of member-written text in the result; arrays are transparent and `*` matches any key. */
  readonly userTextPaths?: readonly string[];
  /**
   * The REST/slash schema this tool mirrors. Every field of it must be an input
   * of the tool unless `exceptions` names it with a reason (the parity spec).
   */
  readonly parity?: {
    readonly rest: z.ZodObject;
    readonly exceptions?: Readonly<Record<string, string>>;
  };
  /** Short phrase for the refusal message of a confirm-class tool ("post a message"). Defaults to the tool name. */
  readonly effect?: string;
  handler(context: ToolContext<Schema>): Promise<unknown>;
};

export type AnyToolRow = ToolRow;

/**
 * Types a row against its own schema and files it as a plain `ToolRow`. The
 * registry validates the arguments with `inputSchema` before it calls the
 * handler, so a handler for one schema may sit in a list of rows with others.
 */
export function defineTool<Schema extends z.ZodObject>(row: ToolRow<Schema>): AnyToolRow {
  return row;
}

/** True when the row's schema takes a `guildId`, which is what routes it through the Manage Server check. */
export const hasGuildId = (row: Pick<AnyToolRow, 'inputSchema'>): boolean =>
  'guildId' in row.inputSchema.shape;

/**
 * Everything a row has to satisfy. Returns the problems (empty when fine) so
 * the registry spec can assert on the real table and, with a fixture row, on
 * the checker itself. `serviceClasses` maps a service class name to its class.
 */
export function checkToolRow(
  row: AnyToolRow,
  serviceClasses: ReadonlyMap<string, { prototype: object }>,
): string[] {
  const problems: string[] = [];
  const fail = (message: string): number => problems.push(`${row.name}: ${message}`);

  if (!/^[a-z]+(_[a-z]+)+$/.test(row.name)) fail('name is not snake_case noun_verb');
  if (row.description.trim().length < 20) fail('description is missing');
  if ((row.userTextPaths?.length ?? 0) > 0 && !/untrusted/i.test(row.description)) {
    fail('description must warn that member-written text in the result is untrusted data');
  }
  if (isWriteClass(row.class) && !/undo|revers/i.test(row.description)) {
    fail('write tool description must say whether and how the change can be undone');
  }
  if (
    (row.class === 'C' || row.class === 'CC') &&
    !(/dryRun/.test(row.description) && /confirmToken/.test(row.description))
  ) {
    fail('confirm-class description must tell the caller to call dryRun first for a confirmToken');
  }

  const shape = (row.inputSchema as z.ZodObject | undefined)?.shape;
  if (shape === undefined) {
    fail('no input schema');
  } else {
    for (const key of Object.keys(guardShapeFor(row.class))) {
      if (!(key in shape)) fail(`${row.class} tool lacks the guard field ${key}`);
    }
    for (const key of ['dryRun', 'confirmToken', 'confirmGuildName']) {
      if (key in shape && !(key in guardShapeFor(row.class))) {
        fail(`${row.class} tool must not take ${key}`);
      }
    }
    if (row.class !== 'R' && row.class !== 'W' && !('guildId' in shape)) {
      fail('a confirm-class tool must take guildId so the confirmation can name the server');
    }
  }

  const [serviceName, method] = row.service.split('.');
  const serviceClass = serviceName === undefined ? undefined : serviceClasses.get(serviceName);
  if (serviceClass === undefined) {
    fail(`service ${String(serviceName)} is not a provider of the application`);
  } else if (
    method === undefined ||
    typeof (serviceClass.prototype as Record<string, unknown>)[method] !== 'function'
  ) {
    fail(`${row.service} is not a method`);
  }

  if (isWriteClass(row.class)) {
    if (row.audit === undefined) fail('write tool has no audit action');
    else if (!AuditActionSchema.safeParse(row.audit).success)
      fail(`unknown audit action ${row.audit}`);
  } else if (row.audit !== undefined) {
    fail('read tool must not name an audit action');
  }
  return problems;
}
