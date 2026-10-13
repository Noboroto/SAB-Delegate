import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApplicationCommandManager, Client, Routes, type REST } from 'discord.js';
import { CommandsService } from 'necord';
import { AppStateService } from '../app-state/app-state.service.js';
import { errorLabel } from '../prisma/pool-factory.js';
import { DISCORD_ENV, type DiscordEnv } from './boot-guard.js';
import { commandHash, commandsInSync, type CommandPayload } from './command-hash.js';

export type RegistrationScope = { kind: 'global' } | { kind: 'guild'; guildId: string };

/** `skipped`: nothing to do or nothing safe to do; `failed`: logged, retried at the next boot. */
export type RegistrationOutcome = 'unchanged' | 'registered' | 'skipped' | 'failed';

/** What the registrar needs from the Discord client, so a test can hand it a stub. */
type DiscordClientPort = {
  rest: Pick<REST, 'get' | 'put'>;
  application: { id: string } | null;
};
type CommandSource = {
  getGlobalCommands(): Array<{ toJSON(): unknown }>;
  getGuildCommands(guildId: string): Array<{ toJSON(): unknown }>;
};
type Route = `/${string}`;

/** Pause before each retry of the registration that follows a wipe (so up to four attempts). */
type RetryBackoff = {
  readonly delaysMs: readonly number[];
  sleep(ms: number): Promise<void>;
};

const DEFAULT_BACKOFF: RetryBackoff = {
  delaysMs: [1000, 2000, 4000],
  sleep: (ms) => sleep(ms),
};

// discord.js keeps this conversion (camelCase builder data to the REST body)
// behind a private static that `ApplicationCommandManager#set` itself uses.
// Registering through the same function keeps the hash and the request body
// identical to what discord.js would have sent; the registrar spec pins it.
export const toRestBody = (data: unknown): CommandPayload =>
  (
    ApplicationCommandManager as unknown as { transformCommand(data: unknown): CommandPayload }
  ).transformCommand(data);

const describeScope = (scope: RegistrationScope): string =>
  scope.kind === 'global' ? 'global' : `guild ${scope.guildId}`;

/**
 * Writes the slash commands to Discord, and only when they changed.
 *
 * Bulk `PUT` is rate limited (2 per 30 s per guild) and replaces the whole set,
 * so writing on every boot burns the budget and, in production, momentarily
 * resets what users see. The last registered payload's hash is kept in
 * `AppState` per application and scope.
 *
 * A matching hash is not trusted on its own: someone can delete a command by
 * hand, or the previous bot's `CREATE_CMD` can replace the set, and the stored
 * hash would still say "registered". So Discord is asked what it holds and a
 * difference registers again.
 *
 * The scope follows the environment: production registers globally, development
 * only in `DISCORD_DEV_GUILD_ID`. A development build never touches global
 * commands, whatever the token.
 */
@Injectable()
export class CommandRegistrar {
  private readonly logger = new Logger(CommandRegistrar.name);

  constructor(
    @Inject(Client) private readonly client: DiscordClientPort,
    @Inject(CommandsService) private readonly commands: CommandSource,
    private readonly appState: AppStateService,
    @Inject(DISCORD_ENV)
    private readonly env: Pick<DiscordEnv, 'APP_ENV' | 'DISCORD_DEV_GUILD_ID'>,
  ) {}

  /** The pauses between retries after a wipe; a test replaces them with instant ones. */
  backoff: RetryBackoff = DEFAULT_BACKOFF;

  /** The only scope this environment may write to. */
  configuredScope(): RegistrationScope {
    if (this.env.APP_ENV === 'development') {
      if (this.env.DISCORD_DEV_GUILD_ID === undefined) {
        throw new RangeError('DISCORD_DEV_GUILD_ID is required when APP_ENV is development');
      }
      return { kind: 'guild', guildId: this.env.DISCORD_DEV_GUILD_ID };
    }
    return { kind: 'global' };
  }

  /**
   * Never throws: a registration problem must not take the bot down, and the
   * next boot tries again. Only the error class is logged.
   */
  async registerIfChanged(): Promise<RegistrationOutcome> {
    try {
      const scope = this.configuredScope();
      const payload = this.payloadFor(scope);
      if (payload.length === 0) {
        // Registering an empty set would delete every command Discord has.
        this.logger.warn(
          `No slash commands are declared; leaving the ${describeScope(scope)} commands untouched`,
        );
        return 'skipped';
      }

      const applicationId = this.applicationId();
      const hash = commandHash(payload);
      const key = hashKey(applicationId, scope);
      const route = routeFor(applicationId, scope);

      if ((await this.appState.get(key)) === hash) {
        const remote = await this.fetchRemote(route);
        if (remote === undefined || commandsInSync(payload, remote)) {
          this.logger.log(`Slash commands unchanged (${payload.length}, ${describeScope(scope)})`);
          return 'unchanged';
        }
        this.logger.warn(
          `Discord holds a different ${describeScope(scope)} command set than the recorded one; registering again`,
        );
      }

      await this.client.rest.put(route, { body: payload });
      await this.appState.set(key, hash);
      this.logger.log(`Registered ${payload.length} slash commands (${describeScope(scope)})`);
      return 'registered';
    } catch (error) {
      this.logger.error(`Slash command registration failed (${errorLabel(error)})`);
      return 'failed';
    }
  }

  /**
   * Deletes every command registered in `scope` and registers the full payload
   * again, in the same call. The owner allows this to clear stray or stale
   * commands (leftovers of an earlier build, a global set from the previous
   * bot); it is never automatic and only runs when asked for explicitly.
   *
   * Refused outside the environment's own scope, so a development build cannot
   * wipe the global commands that the production bot is serving. A global wipe
   * with nothing to register would leave users with no commands at all, so it is
   * refused too; an empty guild payload is fine (it just clears the dev guild).
   *
   * Commands are missing between the two calls, so the second one is retried
   * with a growing pause. If it still fails the scope is left empty: that is
   * logged as an error naming the scope, and the next boot's check finds the
   * difference and registers again.
   */
  async wipeAndRegister(scope: RegistrationScope): Promise<RegistrationOutcome> {
    let wiped = false;
    try {
      const allowed = this.configuredScope();
      if (describeScope(scope) !== describeScope(allowed)) {
        throw new RangeError(
          `Refusing to wipe ${describeScope(scope)} commands in a ${this.env.APP_ENV} environment`,
        );
      }
      const payload = this.payloadFor(scope);
      if (scope.kind === 'global' && payload.length === 0) {
        throw new RangeError('Refusing to wipe global commands with no commands to register');
      }

      const applicationId = this.applicationId();
      const route = routeFor(applicationId, scope);
      await this.client.rest.put(route, { body: [] });
      wiped = true;
      this.logger.warn(`Wiped the ${describeScope(scope)} slash commands`);
      await this.putWithRetry(route, payload);
      await this.appState.set(hashKey(applicationId, scope), commandHash(payload));
      this.logger.log(
        `Registered ${payload.length} slash commands after the wipe (${describeScope(scope)})`,
      );
      return 'registered';
    } catch (error) {
      this.logger.error(
        wiped
          ? `Slash command wipe left the ${describeScope(scope)} commands EMPTY: registering them again failed (${errorLabel(error)}); the next boot registers them`
          : `Slash command wipe failed for ${describeScope(scope)} (${errorLabel(error)})`,
      );
      return 'failed';
    }
  }

  private payloadFor(scope: RegistrationScope): CommandPayload[] {
    const discovered =
      scope.kind === 'global'
        ? this.commands.getGlobalCommands()
        : this.commands.getGuildCommands(scope.guildId);
    return discovered.map((command) => toRestBody(command.toJSON()));
  }

  private applicationId(): string {
    const application = this.client.application;
    if (application === null) throw new Error('Discord application is unavailable before ready');
    return application.id;
  }

  /** `undefined` when Discord could not be asked; the recorded hash then decides. */
  private async fetchRemote(route: Route): Promise<unknown> {
    try {
      return await this.client.rest.get(route);
    } catch (error) {
      this.logger.warn(`Could not read the registered commands (${errorLabel(error)})`);
      return undefined;
    }
  }

  private async putWithRetry(route: Route, payload: CommandPayload[]): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.client.rest.put(route, { body: payload });
        return;
      } catch (error) {
        const delay = this.backoff.delaysMs[attempt];
        if (delay === undefined) throw error;
        this.logger.warn(
          `Registering after the wipe failed (${errorLabel(error)}); retrying in ${delay} ms`,
        );
        await this.backoff.sleep(delay);
      }
    }
  }
}

/**
 * The key carries the application id, so a different application (another
 * token pointed at the same database) never inherits this one's hash.
 */
function hashKey(applicationId: string, scope: RegistrationScope): string {
  return scope.kind === 'global'
    ? `commands:${applicationId}:global`
    : `commands:${applicationId}:guild:${scope.guildId}`;
}

function routeFor(applicationId: string, scope: RegistrationScope): Route {
  return scope.kind === 'global'
    ? Routes.applicationCommands(applicationId)
    : Routes.applicationGuildCommands(applicationId, scope.guildId);
}
