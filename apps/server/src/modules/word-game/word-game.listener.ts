import { Logger } from '@nestjs/common';
import { WordStatus, type WordSubmitResult } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { Context, On, type ContextOf } from 'necord';
import pLimit, { type LimitFunction } from 'p-limit';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { WordGameService } from './word-game.service.js';
import { formatDefinition } from './word-definition.format.js';
import { WordDefinitionService } from './word-definition.service.js';

/**
 * What the listener uses of a message. Structural on purpose: the message a
 * Necord handler receives and the one discord.js types here are the same object
 * at runtime but separate declarations for the compiler, which rejects a
 * nominal parameter type across that boundary.
 */
type Reactable = {
  react(emoji: string): Promise<unknown>;
  reply(options: {
    content: string;
    allowedMentions: { parse?: []; repliedUser: boolean };
    flags?: MessageFlags.SuppressEmbeds;
  }): Promise<unknown>;
};

/**
 * Longest a move may hold its channel's queue. The pool has no query timeout,
 * so a stalled connection would otherwise freeze the game in that channel; past
 * this the next move is judged, and the database still refuses a stale one.
 */
const JUDGE_TIMEOUT_MS = 10_000;

const SUCCESS_REACTION = '✅';
const FAILURE_REACTION = '❌';

/**
 * Turns messages in the game channel into moves. The service decides what a
 * message is; this only reacts and replies once the move is committed.
 * `NOTHING` and `MAX_WORD` get no answer at all: a chat message in the channel
 * is not a mistake, and a finished round stays quiet until it is reset. An
 * accepted word gets its meaning underneath when a dictionary has one.
 */
@DiscordCommands()
export class WordGameListener {
  private readonly logger = new Logger(WordGameListener.name);
  /**
   * One judging queue per channel. Handlers run concurrently, so without it a
   * later message whose database round-trip happens to finish first takes the
   * move, and the player who sent first is refused against a word sent after
   * theirs. Only judging is queued: reactions and the meaning lookup run
   * outside, so a slow reply never holds up the next move. In process only,
   * which is enough because one process serves the token.
   */
  private readonly channelQueues = new Map<string, LimitFunction>();

  constructor(
    private readonly game: WordGameService,
    private readonly locales: GuildLocaleService,
    private readonly ready: DiscordReadyService,
    private readonly definitions: WordDefinitionService,
  ) {}

  @On('messageCreate')
  async onMessageCreate(@Context() [message]: ContextOf<'messageCreate'>): Promise<void> {
    // The bot's own reactions and replies come back as events too; bots never
    // take part. Cheap checks first: this runs for every message the bot sees.
    if (message.guildId === null || message.author.bot) return;
    // The database pool is about to close once shutdown began.
    if (this.ready.isStopping()) return;

    const guildId = message.guildId;
    // A failure here (the database, a move stuck past the timeout) is left to
    // the exception filter, which logs it and reports it to #bot-log.
    const result = await this.inArrivalOrder(message.channelId, () =>
      // A move that waited in the queue past the start of shutdown would only
      // meet a closing pool.
      this.ready.isStopping()
        ? Promise.resolve(null)
        : this.game.submitWord(guildId, {
            channelId: message.channelId,
            authorId: message.author.id,
            content: message.content,
          }),
    );
    if (result === null) return;
    // The service judged `content` lower-cased as a whole; a move is that word.
    await this.answer(message, guildId, result, message.content.toLowerCase());
  }

  /**
   * Runs `task` after every earlier task of the channel, giving up on it after
   * `JUDGE_TIMEOUT_MS`. The queue is joined before this handler's own first
   * `await`; every message passes through the same Necord wrapping before
   * that, so the order is the order Discord delivered them in as long as no
   * async guard or pipe is added to this class. An empty queue is dropped.
   */
  private async inArrivalOrder<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    let queue = this.channelQueues.get(channelId);
    if (queue === undefined) {
      queue = pLimit(1);
      this.channelQueues.set(channelId, queue);
    }
    try {
      return await queue(() => withTimeout(task(), JUDGE_TIMEOUT_MS));
    } finally {
      if (queue.activeCount === 0 && queue.pendingCount === 0) {
        this.channelQueues.delete(channelId);
      }
    }
  }

  private async answer(
    message: Reactable,
    guildId: string,
    result: WordSubmitResult,
    word: string,
  ): Promise<void> {
    const { status } = result;
    if (status === WordStatus.NOTHING || status === WordStatus.MAX_WORD) return;
    if (status === WordStatus.SUCCESS && !result.finished) {
      await this.respond(message, SUCCESS_REACTION);
      await this.explain(message, guildId, word);
      return;
    }

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
   * The meaning of an accepted word, after its check mark so the player sees
   * the verdict at once. It informs, it does not answer the player, so it does
   * not notify them; link previews would bury the channel. With no meaning
   * found the check mark stays alone.
   */
  private async explain(message: Reactable, guildId: string, word: string): Promise<void> {
    try {
      const definition = await this.definitions.define(word);
      // The lookup can take seconds; the database pool may be closing by now.
      if (definition === null || this.ready.isStopping()) return;
      const t = translatorFor(await this.locales.resolve(guildId));
      await message.reply({
        content: formatDefinition(word, definition, t),
        // The text comes from public wikis and a translation service: whatever
        // mention it carries must not ping anyone.
        allowedMentions: { parse: [], repliedUser: false },
        flags: MessageFlags.SuppressEmbeds,
      });
    } catch (error) {
      this.logger.warn(`Could not reply with a word's meaning (${errorLabel(error)})`);
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
      // The client mentions nobody by default; a reply still notifies the player it answers.
      await message.reply({ content: text, allowedMentions: { repliedUser: true } });
    } catch (error) {
      this.logger.warn(`Could not reply to a word (${errorLabel(error)})`);
    }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Judging a word timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
