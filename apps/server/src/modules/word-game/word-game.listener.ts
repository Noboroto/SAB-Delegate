import { Logger } from '@nestjs/common';
import { WordStatus, type WordSubmitResult } from '@sab/shared';
import { Context, On, type ContextOf } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { WordGameService } from './word-game.service.js';

/**
 * What the listener uses of a message. Structural on purpose: the message a
 * Necord handler receives and the one discord.js types here are the same object
 * at runtime but separate declarations for the compiler, which rejects a
 * nominal parameter type across that boundary.
 */
type Reactable = {
  react(emoji: string): Promise<unknown>;
  reply(content: string): Promise<unknown>;
};

const SUCCESS_REACTION = '✅';
const FAILURE_REACTION = '❌';

/**
 * Turns messages in the game channel into moves. The service decides what a
 * message is; this only reacts and replies once the move is committed.
 * `NOTHING` and `MAX_WORD` get no answer at all: a chat message in the channel
 * is not a mistake, and a finished round stays quiet until it is reset.
 */
@DiscordCommands()
export class WordGameListener {
  private readonly logger = new Logger(WordGameListener.name);

  constructor(
    private readonly game: WordGameService,
    private readonly locales: GuildLocaleService,
    private readonly ready: DiscordReadyService,
  ) {}

  @On('messageCreate')
  async onMessageCreate(@Context() [message]: ContextOf<'messageCreate'>): Promise<void> {
    // The bot's own reactions and replies come back as events too; bots never
    // take part. Cheap checks first: this runs for every message the bot sees.
    if (message.guildId === null || message.author.bot) return;
    // The database pool is about to close once shutdown began.
    if (this.ready.isStopping()) return;

    const result = await this.game.submitWord(message.guildId, {
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content,
    });
    await this.answer(message, message.guildId, result);
  }

  private async answer(
    message: Reactable,
    guildId: string,
    result: WordSubmitResult,
  ): Promise<void> {
    const { status } = result;
    if (status === WordStatus.NOTHING || status === WordStatus.MAX_WORD) return;
    if (status === WordStatus.SUCCESS && !result.finished) {
      await this.respond(message, SUCCESS_REACTION);
      return;
    }

    // Only the replies need the language, so the lookup is skipped for the
    // plain success that most moves are.
    const t = translatorFor(await this.locales.resolve(guildId));
    switch (status) {
      case WordStatus.SUCCESS:
        await this.respond(
          message,
          SUCCESS_REACTION,
          t('word-game.reply.finished', { maxWords: String(result.maxWords) }),
        );
        return;
      case WordStatus.NOT_EXIST:
        await this.respond(message, FAILURE_REACTION, t('word-game.reply.NOT_EXIST'));
        return;
      case WordStatus.SAME_AUTHOR:
        await this.respond(message, FAILURE_REACTION, t('word-game.reply.SAME_AUTHOR'));
        return;
      case WordStatus.SAME_WORD:
        await this.respond(message, FAILURE_REACTION, t('word-game.reply.SAME_WORD'));
        return;
      case WordStatus.NOT_LINK:
        await this.respond(
          message,
          FAILURE_REACTION,
          t('word-game.reply.NOT_LINK', { starter: result.starter ?? '' }),
        );
        return;
    }
  }

  /**
   * Reaction first, then the reply, the order players have always seen. Either
   * can fail routinely (a deleted message, a channel that withdrew the
   * permission); that must neither stop the other nor leave the handler with an
   * unhandled rejection.
   */
  private async respond(message: Reactable, reaction: string, text?: string): Promise<void> {
    try {
      await message.react(reaction);
    } catch (error) {
      this.logger.warn(`Could not react to a word (${errorLabel(error)})`);
    }
    if (text === undefined) return;
    try {
      await message.reply(text);
    } catch (error) {
      this.logger.warn(`Could not reply to a word (${errorLabel(error)})`);
    }
  }
}
