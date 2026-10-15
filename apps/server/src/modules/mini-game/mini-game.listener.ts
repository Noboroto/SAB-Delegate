import { Logger } from '@nestjs/common';
import { Context, On, type ContextOf } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { ChannelQueue } from '../../discord/helpers/channel-queue.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { GameChannelService } from '../game-core/game-channel.service.js';
import { CountingService } from './counting.service.js';
import {
  formatOpening,
  formatScrambleHint,
  formatScrambleSolved,
  formatWordleTurn,
  type GamePost,
} from './mini-game.format.js';
import type { CountingOutcome, ScrambleOutcome, WordleOutcome } from './mini-game.types.js';
import { ScrambleService } from './scramble.service.js';
import { WordleService } from './wordle.service.js';

/** Longest a move may hold its channel's queue; see `ChannelQueue`. */
const JUDGE_TIMEOUT_MS = 10_000;

const SUCCESS_REACTION = '✅';
const FAILURE_REACTION = '❌';

/** What the listener uses of a message; structural for the reason given in `WordGameListener`. */
type Answerable = {
  react(emoji: string): Promise<unknown>;
  reply(
    options: GamePost & {
      allowedMentions: { parse: []; repliedUser: boolean };
      failIfNotExists: boolean;
    },
  ): Promise<unknown>;
};

type Move =
  | { game: 'COUNTING'; outcome: CountingOutcome }
  | { game: 'SCRAMBLE'; outcome: ScrambleOutcome }
  | { game: 'WORDLE'; outcome: WordleOutcome };

/**
 * Turns messages in the channel games' channels into moves. The services
 * decide what a message is; this only answers once the move is committed.
 * Answers never ping: a mention in them only names the player.
 */
@DiscordCommands()
export class MiniGameListener {
  private readonly logger = new Logger(MiniGameListener.name);
  private readonly queue = new ChannelQueue(JUDGE_TIMEOUT_MS, 'Judging a game move');

  constructor(
    private readonly channels: GameChannelService,
    private readonly counting: CountingService,
    private readonly scramble: ScrambleService,
    private readonly wordle: WordleService,
    private readonly locales: GuildLocaleService,
    private readonly ready: DiscordReadyService,
  ) {}

  @On('messageCreate')
  async onMessageCreate(@Context() [message]: ContextOf<'messageCreate'>): Promise<void> {
    if (message.guildId === null || message.author.bot) return;
    if (this.ready.isStopping()) return;

    const guildId = message.guildId;
    const input = {
      channelId: message.channelId,
      authorId: message.author.id,
      content: message.content,
    };
    // The route is looked up inside the queue: the queue must be joined before
    // the handler's first `await` for moves to keep their arrival order. A
    // failure is left to the exception filter, which reports it to #bot-log.
    const move = await this.queue.run(message.channelId, async (): Promise<Move | null> => {
      if (this.ready.isStopping()) return null;
      const game = await this.channels.routeOf(guildId, message.channelId);
      switch (game) {
        case null:
          return null;
        case 'COUNTING':
          return { game, outcome: await this.counting.submit(guildId, input) };
        case 'SCRAMBLE':
          return { game, outcome: await this.scramble.submit(guildId, input) };
        case 'WORDLE':
          return { game, outcome: await this.wordle.submit(guildId, input) };
      }
    });
    if (move === null || move.outcome.status === 'NOTHING') return;
    await this.answer(message, guildId, move, message.author.id);
  }

  private async answer(
    message: Answerable,
    guildId: string,
    move: Move,
    authorId: string,
  ): Promise<void> {
    if (move.game === 'COUNTING' && move.outcome.status === 'COUNTED') {
      await this.respond(message, SUCCESS_REACTION);
      return;
    }
    const t = translatorFor(await this.locales.resolve(guildId));
    switch (move.game) {
      case 'COUNTING': {
        const { outcome } = move;
        if (outcome.status === 'WRONG_NUMBER') {
          await this.respond(message, FAILURE_REACTION, {
            content: t('mini-game.counting.wrongNumber', {
              expected: String(outcome.expected),
              best: String(outcome.best),
            }),
          });
        } else if (outcome.status === 'SAME_USER') {
          await this.respond(message, FAILURE_REACTION, {
            content: t('mini-game.counting.sameUser', { best: String(outcome.best) }),
          });
        }
        return;
      }
      case 'SCRAMBLE': {
        const { outcome } = move;
        if (outcome.status === 'WRONG') {
          await this.respond(
            message,
            FAILURE_REACTION,
            outcome.hint === undefined ? undefined : formatScrambleHint(t, outcome.hint),
          );
          return;
        }
        if (outcome.status !== 'SOLVED') return;
        await this.respond(
          message,
          SUCCESS_REACTION,
          formatScrambleSolved(t, outcome.guess, outcome.meaning, authorId, outcome.next),
        );
        return;
      }
      case 'WORDLE': {
        const { outcome } = move;
        switch (outcome.status) {
          case 'NOTHING':
            return;
          case 'NOT_IN_LIST':
            await this.respond(message, FAILURE_REACTION, {
              content: t('mini-game.wordle.notInList'),
            });
            return;
          case 'SAME_USER':
            await this.respond(message, FAILURE_REACTION, {
              content: t('mini-game.wordle.sameUser'),
            });
            return;
          case 'ALREADY_GUESSED':
            await this.respond(message, FAILURE_REACTION, {
              content: t('mini-game.wordle.alreadyGuessed'),
            });
            return;
          case 'GUESSED':
            await this.respond(message, undefined, {
              embeds: [formatWordleTurn(t, outcome, authorId)],
            });
            return;
          case 'SOLVED':
          case 'LOST':
            await this.respond(
              message,
              outcome.status === 'SOLVED' ? SUCCESS_REACTION : undefined,
              {
                embeds: [
                  formatWordleTurn(t, outcome, authorId),
                  ...(formatOpening(t, { game: 'WORDLE', previous: null }).embeds ?? []),
                ],
              },
            );
            return;
        }
      }
    }
  }

  /**
   * Reaction first, then the reply. Either can fail routinely (a deleted
   * message, a channel that withdrew the permission); that must neither stop
   * the other nor leave the handler with an unhandled rejection.
   */
  private async respond(
    message: Answerable,
    reaction: string | undefined,
    reply?: GamePost,
  ): Promise<void> {
    if (reaction !== undefined) {
      try {
        await message.react(reaction);
      } catch (error) {
        this.logger.warn(`Could not react to a game move (${errorLabel(error)})`);
      }
    }
    if (reply === undefined) return;
    try {
      // A winner may delete their message at once; the next puzzle rides on this
      // reply, so it then goes out as a plain message instead of failing.
      await message.reply({
        ...reply,
        allowedMentions: { parse: [], repliedUser: false },
        failIfNotExists: false,
      });
    } catch (error) {
      this.logger.warn(`Could not reply to a game move (${errorLabel(error)})`);
    }
  }
}
