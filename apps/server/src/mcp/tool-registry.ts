import { Logger, type Type } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/server';
import { ErrorCode, type z } from '@sab/shared';
import type { GuildAccessService } from '../common/guild-access/guild-access.service.js';
import { ServiceError } from '../common/errors/service-error.js';
import type { ConfirmTokenService } from './confirm-token.service.js';
import { callerActor, type McpCaller } from './mcp-caller.js';
import { hasGuildId, type AnyToolRow } from './tool-definition.js';
import { annotationsFor, toolGuard } from './tool-guard.js';
import {
  guarded,
  markUntrusted,
  ok,
  refuseUnconfirmed,
  GuildRefSchema,
  type GuildRef,
  type McpTarget,
  type ToolResult,
} from './tool-result.js';
import { splitGuardFields } from './write-guard.js';

// Domain tables. A tool agent adds exactly two lines: its import below and its
// table in DOMAIN_TOOL_TABLES. A row is added to its own file, never here.
// -- imports of tools/<domain>.tools.js go below this line --
import { GUILD_TOOLS } from './tools/guild.tools.js';
import { GUILD_CONFIG_TOOLS } from './tools/guild-config.tools.js';
import { BOT_PROFILE_TOOLS } from './tools/bot-profile.tools.js';
import { COMMANDS_TOOLS } from './tools/commands.tools.js';
import { LOGS_TOOLS } from './tools/logs.tools.js';
import { BIRTHDAY_TOOLS } from './tools/birthday.tools.js';
import { NOTE_TOOLS } from './tools/note.tools.js';
import { WORDGAME_TOOLS } from './tools/wordgame.tools.js';
import { SCHEDULE_TOOLS } from './tools/schedule.tools.js';
import { MESSAGE_TOOLS } from './tools/message.tools.js';
import { CHATBOT_TOOLS } from './tools/chatbot.tools.js';

/**
 * Every domain's rows. Registration iterates the concatenation and nothing
 * else, so a tool exists exactly when it has a row.
 */
export const DOMAIN_TOOL_TABLES: readonly (readonly AnyToolRow[])[] = [
  // -- one `<DOMAIN>_TOOLS,` line per domain file goes below this line --
  GUILD_TOOLS,
  GUILD_CONFIG_TOOLS,
  BOT_PROFILE_TOOLS,
  COMMANDS_TOOLS,
  LOGS_TOOLS,
  BIRTHDAY_TOOLS,
  NOTE_TOOLS,
  WORDGAME_TOOLS,
  SCHEDULE_TOOLS,
  MESSAGE_TOOLS,
  CHATBOT_TOOLS,
];

export const TOOL_REGISTRY: readonly AnyToolRow[] = DOMAIN_TOOL_TABLES.flat();

/** What the runner needs from the application; the factory supplies the real ones. */
type ToolRunnerDeps = {
  readonly access: Pick<GuildAccessService, 'assertManageGuild'>;
  readonly tokens: Pick<ConfirmTokenService, 'issue' | 'verify' | 'reinstate'>;
  readonly target: McpTarget;
  readonly guildName: (guildId: string) => string | undefined;
  readonly services: { get<T>(token: Type<T>): T };
};

const logger = new Logger('McpTool');

function guildOf(
  row: AnyToolRow,
  input: Record<string, unknown>,
  deps: ToolRunnerDeps,
): GuildRef | null {
  if (!hasGuildId(row)) return null;
  const id = input['guildId'];
  if (typeof id !== 'string') throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return GuildRefSchema.parse({ id, name: deps.guildName(id) ?? id });
}

async function run(
  row: AnyToolRow,
  input: Record<string, unknown>,
  caller: McpCaller,
  deps: ToolRunnerDeps,
): Promise<ToolResult> {
  toolGuard(caller, row.class).require();

  const guild = guildOf(row, input, deps);
  if (guild !== null) {
    // Before any service is touched. Writes ask Discord again; reads accept a
    // 30 s old answer. The same refusal covers "no such server" and "not yours".
    await deps.access.assertManageGuild(caller.discordUserId, guild.id, {
      fresh: row.class !== 'R',
    });
  }
  const { args, dryRun, confirmToken, confirmGuildName } = splitGuardFields(input);
  const context = {
    args,
    dryRun,
    caller,
    actor: callerActor(caller),
    guild,
    service: <T>(token: Type<T>): T => deps.services.get(token),
  };
  const untrusted = row.userTextPaths ?? [];
  const resultOptions = { untrusted, target: deps.target, guild };

  if (row.class === 'R') return ok(await row.handler(context), resultOptions);

  if (dryRun) {
    const preview = markUntrusted(await row.handler(context), untrusted);
    if (row.class === 'W') return ok({ dryRun: true, preview }, { target: deps.target, guild });
    const { token, expiresInSeconds } = deps.tokens.issue(caller.apiKeyId, row.name, args);
    return ok(
      { dryRun: true, preview, confirmToken: token, expiresInSeconds },
      { target: deps.target, guild },
    );
  }
  if (row.class === 'W') return ok(await row.handler(context), resultOptions);

  // C and CC change things for real. `guild` is set: checkToolRow requires a guildId.
  const where = guild ?? { id: 'unknown', name: 'unknown' };
  const effect = row.effect ?? row.name;
  if (confirmToken === undefined) return refuseUnconfirmed(deps.target, where, effect);
  if (row.class === 'CC' && confirmGuildName !== where.name) {
    return refuseUnconfirmed(
      deps.target,
      where,
      effect,
      'confirmGuildName must be the exact current name of the server',
    );
  }
  if (!deps.tokens.verify(confirmToken, caller.apiKeyId, row.name, args)) {
    return refuseUnconfirmed(
      deps.target,
      where,
      effect,
      'confirmToken is invalid, expired, already used, or was issued for different arguments',
    );
  }
  try {
    return ok(await row.handler(context), resultOptions);
  } catch (error) {
    // The server's action budget refuses before anything happens, so the
    // token is given back: the holder waits and retries without a new preview.
    if (error instanceof ServiceError && error.code === ErrorCode.RATE_LIMITED) {
      deps.tokens.reinstate(confirmToken, caller.apiKeyId, row.name, args);
    }
    throw error;
  }
}

/**
 * Registers the rows this caller may see. Visibility is a convenience only:
 * `run` enforces the key's mode again on every call.
 */
export function registerTools(
  server: McpServer,
  deps: ToolRunnerDeps,
  caller: McpCaller,
  rows: readonly AnyToolRow[] = TOOL_REGISTRY,
): void {
  for (const row of rows) {
    if (!toolGuard(caller, row.class).visible) continue;
    server.registerTool(
      row.name,
      {
        description: row.description,
        inputSchema: row.inputSchema,
        annotations: annotationsFor(row.class),
      },
      (input: z.infer<typeof row.inputSchema>) =>
        guarded(async () => {
          const started = Date.now();
          try {
            return await run(row, input, caller, deps);
          } finally {
            // Never the arguments: they can hold message text and member data.
            logger.log(
              `tool=${row.name} key=${caller.apiKeyId} guild=${typeof input['guildId'] === 'string' ? input['guildId'] : '-'} ms=${Date.now() - started}`,
            );
          }
        }),
    );
  }
}
