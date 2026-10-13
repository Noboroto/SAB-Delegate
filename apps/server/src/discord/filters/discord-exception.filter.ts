import { Catch, Logger, type ExceptionFilter, type ExecutionContext } from '@nestjs/common';
import { ServiceError } from '../../common/errors/service-error.js';
import { MessageFlags } from 'discord.js';
import { NecordExecutionContext } from 'necord';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { ErrorReporter } from '../error-reporter.service.js';
import { discordErrorCode, isDeadInteractionError } from '../helpers/reply.js';

/** The slice of an interaction the filter reads and answers through. */
type FailedInteraction = {
  readonly guildId?: string | null;
  readonly locale?: string;
  readonly guildLocale?: string | null;
  readonly replied?: boolean;
  readonly deferred?: boolean;
  readonly ephemeral?: boolean | null;
  readonly commandName?: string;
  readonly options?: {
    getSubcommandGroup?(required?: boolean): string | null;
    getSubcommand?(required?: boolean): string | null;
  };
  isRepliable(): boolean;
  isAutocomplete(): boolean;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
  deleteReply?(): Promise<unknown>;
  followUp(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  respond?(choices: []): Promise<unknown>;
};

function asInteraction(value: unknown): FailedInteraction | undefined {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as FailedInteraction).isRepliable === 'function'
    ? (value as FailedInteraction)
    : undefined;
}

/**
 * Last line of defence for every Necord handler (commands, listeners, modals,
 * components). It never throws and never lets `err.message` reach a user: the
 * real error goes to the log and `#bot-log`, the user gets a generic sentence
 * in the guild's language. Attach it with `@DiscordCommands()`.
 */
@Catch()
export class DiscordExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DiscordExceptionFilter.name);

  constructor(
    private readonly reporter: ErrorReporter,
    private readonly locales: GuildLocaleService,
  ) {}

  async catch(exception: unknown, host: ExecutionContext): Promise<void> {
    try {
      await this.handle(exception, host);
    } catch (failure) {
      // Whatever went wrong while handling an error, it ends here: an escape
      // would become an unhandled rejection in the gateway event loop.
      this.logger.error(`Error handling failed (${errorLabel(failure)})`);
    }
  }

  private async handle(exception: unknown, host: ExecutionContext): Promise<void> {
    const necord = NecordExecutionContext.create(host);
    const [context] = necord.getContext<unknown[]>();
    const interaction = asInteraction(context);

    if (isDeadInteractionError(exception)) {
      // Nobody is left to answer and a second reply would fail the same way.
      this.logger.warn(
        `Interaction expired before it could be answered (${errorLabel(exception)})`,
      );
      return;
    }

    const expected = exception instanceof ServiceError;
    try {
      if (interaction !== undefined) await this.respond(interaction, exception);
    } finally {
      // After the answer, and not awaited: the person waiting on the command
      // must not also wait on `#bot-log`, which may be slow or rate limited.
      if (!expected) this.reportInBackground(describe(necord, interaction), exception);
    }
  }

  private async respond(interaction: FailedInteraction, exception: unknown): Promise<void> {
    if (interaction.isAutocomplete()) {
      await this.answer(() => interaction.respond?.([]));
      return;
    }
    if (!interaction.isRepliable()) return;

    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const content =
      exception instanceof ServiceError
        ? t(`errors.${exception.code}`, exception.params)
        : t('common.commandFailed');
    const flags = MessageFlags.Ephemeral;
    if (interaction.replied !== true && interaction.deferred === true) {
      // An ephemeral placeholder is edited into place. A public one cannot be
      // made private, so it is removed and the error goes out as a private
      // follow-up: an error is for the person who ran the command, not the room.
      if (interaction.ephemeral === true) {
        await this.answer(() => interaction.editReply({ content }));
        return;
      }
      await this.removePlaceholder(interaction);
      await this.answer(() => interaction.followUp({ content, flags }));
      return;
    }
    await this.answer(() =>
      interaction.replied === true
        ? interaction.followUp({ content, flags })
        : interaction.reply({ content, flags }),
    );
  }

  private async removePlaceholder(interaction: FailedInteraction): Promise<void> {
    try {
      await interaction.deleteReply?.();
    } catch (error) {
      // 10008: already gone; 10062: the token expired. Either way there is
      // nothing left to remove.
      const code = discordErrorCode(error);
      if (code === 10008 || code === 10062) return;
      this.logger.warn(`Could not remove the public placeholder (${errorLabel(error)})`);
    }
  }

  private reportInBackground(title: string, exception: unknown): void {
    // The reporter does not throw; the catch covers a replaced or broken one so
    // that nothing here can become an unhandled rejection.
    void (async () => {
      try {
        await this.reporter.report(title, exception);
      } catch (failure) {
        this.logger.error(`Error report failed (${errorLabel(failure)})`);
      }
    })();
  }

  private async answer(send: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(`Could not answer the failed interaction (${errorLabel(error)})`);
    }
  }
}

function describe(
  necord: NecordExecutionContext,
  interaction: FailedInteraction | undefined,
): string {
  const where = [necord.getClass()?.name, necord.getHandler()?.name].filter(Boolean).join('.');
  const command = commandPath(interaction);
  return `Error in ${where === '' ? 'a Discord handler' : where}${command === '' ? '' : ` (${command})`}`;
}

/** `/set log-channel`, `/group sub command`; empty when the context is not a command. */
function commandPath(interaction: FailedInteraction | undefined): string {
  if (interaction?.commandName === undefined) return '';
  // `false`: the option may be absent, and the lookup must not throw then.
  const group = interaction.options?.getSubcommandGroup?.(false);
  const subcommand = interaction.options?.getSubcommand?.(false);
  const parts = [interaction.commandName, group, subcommand].filter(
    (part): part is string => typeof part === 'string',
  );
  return `/${parts.join(' ')}`;
}
