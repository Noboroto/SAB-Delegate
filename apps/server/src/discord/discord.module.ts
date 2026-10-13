import { Inject, Logger, Module, type DynamicModule } from '@nestjs/common';
import { Context, NecordModule, On, Once, type ContextOf } from 'necord';
import { AppStateModule } from '../app-state/app-state.service.js';
import { I18nModule } from '../i18n/guild-locale.service.js';
import { errorLabel } from '../prisma/pool-factory.js';
import { BootGuard, BootGuardModule, DISCORD_ENV, type DiscordEnv } from './boot-guard.js';
import { CommandRegistrar } from './command-registrar.js';
import { DiscordCommands } from './decorators/discord-commands.decorator.js';
import { DiscordReadyModule, DiscordReadyService } from './discord-ready.service.js';
import { ErrorReporter } from './error-reporter.service.js';
import { buildNecordOptions } from './necord-options.js';
import { ChannelAccessService } from './services/channel-access.service.js';
import { DiscordReactionService } from './services/discord-reaction.service.js';
import { MessageResolver } from './services/message-resolver.service.js';

/**
 * Reacts to the gateway session itself: registers the slash commands once the
 * client is ready, then opens the gate for everything waiting on Discord.
 */
@DiscordCommands()
export class DiscordLifecycleListener {
  private readonly logger = new Logger(DiscordLifecycleListener.name);

  constructor(
    private readonly registrar: CommandRegistrar,
    private readonly ready: DiscordReadyService,
    @Inject(DISCORD_ENV) private readonly env: Pick<DiscordEnv, 'COMMANDS_FORCE_RESET'>,
  ) {}

  @Once('clientReady')
  async onClientReady(@Context() [client]: ContextOf<'clientReady'>): Promise<void> {
    this.logger.log(`Ready! Logged in as ${client.user.tag}`);
    try {
      await this.registerCommands();
    } finally {
      // Whatever happened to the registration, the bot is up: workers and the
      // readiness probe must not wait on a rate-limited or failed `PUT`.
      this.ready.markReady();
    }
  }

  // discord.js emits 'error' for websocket failures; an emitter without a
  // listener turns that into an uncaught exception.
  @On('error')
  onClientError(@Context() [error]: ContextOf<'error'>): void {
    this.logger.error(`Discord client error (${errorLabel(error)})`);
  }

  private async registerCommands(): Promise<void> {
    try {
      if (this.env.COMMANDS_FORCE_RESET) {
        this.logger.warn('COMMANDS_FORCE_RESET is set: wiping and registering the slash commands');
        await this.registrar.wipeAndRegister(this.registrar.configuredScope());
      } else {
        await this.registrar.registerIfChanged();
      }
    } catch (error) {
      this.logger.error(`Slash command registration aborted (${errorLabel(error)})`);
    }
  }
}

/** Set `MIGRATION_PENDING` only in the raw environment: Nest builds this module before anything is parsed. */
export const migrationPendingFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env['MIGRATION_PENDING']?.trim() === 'true';

@Module({})
export class DiscordModule {
  /**
   * With `MIGRATION_PENDING=true` the Necord module is not loaded at all, so
   * the bot never logs in and no command is registered; only the readiness
   * signal stays, always "not ready". Feature modules that talk to Discord must
   * be left out of the application in that mode as well.
   *
   * Otherwise the token's application is verified before the gateway login,
   * which Necord performs in its own bootstrap hook: the async options factory
   * runs while the container is built, ahead of every bootstrap hook.
   */
  static forRoot(env: Readonly<Record<string, string | undefined>> = process.env): DynamicModule {
    if (migrationPendingFromEnv(env)) {
      return {
        module: DiscordModule,
        global: true,
        imports: [DiscordReadyModule],
        exports: [DiscordReadyModule],
      };
    }
    return {
      module: DiscordModule,
      global: true,
      imports: [
        DiscordReadyModule,
        BootGuardModule,
        I18nModule,
        AppStateModule,
        NecordModule.forRootAsync({
          imports: [BootGuardModule],
          inject: [BootGuard, DISCORD_ENV],
          useFactory: async (guard: BootGuard, discordEnv: DiscordEnv) => {
            await guard.assertIdentity();
            return buildNecordOptions(discordEnv);
          },
        }),
      ],
      providers: [
        ErrorReporter,
        CommandRegistrar,
        DiscordLifecycleListener,
        ChannelAccessService,
        DiscordReactionService,
        MessageResolver,
      ],
      exports: [
        DiscordReadyModule,
        BootGuardModule,
        I18nModule,
        ErrorReporter,
        ChannelAccessService,
        DiscordReactionService,
        MessageResolver,
      ],
    };
  }
}
