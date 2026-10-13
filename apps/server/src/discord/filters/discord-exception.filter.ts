import { Catch, Logger, type ExceptionFilter, type ExecutionContext } from '@nestjs/common';
import type { ErrorCode } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { NecordExecutionContext } from 'necord';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { ErrorReporter } from '../error-reporter.service.js';
import { isDeadInteractionError } from '../helpers/reply.js';

/**
 * A failure the person who ran the command is meant to read about (bad input,
 * missing permission). It is answered with the catalog text for its code and is
 * not reported to `#bot-log`: it is not a bug.
 */
export class CommandError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'CommandError';
  }
}

/** The slice of an interaction the filter reads and answers through. */
type FailedInteraction = {
  readonly guildId?: string | null;
  readonly locale?: string;
  readonly guildLocale?: string | null;
  readonly replied?: boolean;
  readonly deferred?: boolean;
  isRepliable(): boolean;
  isAutocomplete(): boolean;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
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

    const expected = exception instanceof CommandError;
    if (!expected) await this.reporter.report(describe(necord), exception);
    if (interaction === undefined) return;

    if (interaction.isAutocomplete()) {
      await this.answer(() => interaction.respond?.([]));
      return;
    }
    if (!interaction.isRepliable()) return;

    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const content = expected ? t(`errors.${exception.code}`) : t('common.commandFailed');
    await this.answer(() => {
      const flags = MessageFlags.Ephemeral;
      if (interaction.replied === true) return interaction.followUp({ content, flags });
      // A deferred reply is edited into place; replying again would be refused.
      if (interaction.deferred === true) return interaction.editReply({ content });
      return interaction.reply({ content, flags });
    });
  }

  private async answer(send: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(`Could not answer the failed interaction (${errorLabel(error)})`);
    }
  }
}

function describe(necord: NecordExecutionContext): string {
  const where = [necord.getClass()?.name, necord.getHandler()?.name].filter(Boolean).join('.');
  return `Error in ${where === '' ? 'a Discord handler' : where}`;
}
