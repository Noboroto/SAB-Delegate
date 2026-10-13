import { Logger } from '@nestjs/common';
import { Context, On, type ContextOf } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { resolveReactionEmoji } from './emoji-resolver.js';
import { ReactionDictionary } from './reaction-dictionary.js';

/** The message was deleted before the bot could react. */
const UNKNOWN_MESSAGE = 10008;
/** The message already carries the most distinct reactions Discord allows. */
const MAX_REACTIONS_REACHED = 30010;
/** Distinct reactions a message can hold; asking for more can only fail. */
const MAX_REACTIONS_PER_MESSAGE = 20;

/**
 * What reacting needs, structurally (see `emoji-resolver.ts`). `content` is
 * null on a message that arrived without its text.
 */
type Reactable<Emoji extends { name: string | null }> = {
  readonly content: string | null;
  readonly guild: Parameters<typeof resolveReactionEmoji<Emoji>>[0];
  react(emoji: Emoji | string): Promise<unknown>;
};

/**
 * Reacts to "react <emoji>" and to the phrases of the dictionary, on new
 * messages and on edits. Every message counts, the bot's own included.
 *
 * A reaction fails routinely (no permission, an emoji the server does not
 * have); that is logged and skipped, never
 * thrown, so one bad emoji does not stop the others or reach the user.
 */
@DiscordCommands()
export class AutoReactListener {
  private readonly logger = new Logger(AutoReactListener.name);

  constructor(private readonly dictionary: ReactionDictionary) {}

  @On('messageCreate')
  async onMessageCreate(@Context() [message]: ContextOf<'messageCreate'>): Promise<void> {
    await this.react(message);
  }

  @On('messageUpdate')
  async onMessageUpdate(@Context() [before, updated]: ContextOf<'messageUpdate'>): Promise<void> {
    // Discord also sends an update when it only unfurls a link into an embed;
    // the text is unchanged then, and reacting again would repeat the failures.
    // Without the message partial, only cached messages reach this event, so
    // `updated` always carries its text.
    if (before.content === updated.content) return;
    await this.react(updated);
  }

  private async react<Emoji extends { name: string | null }>(
    message: Reactable<Emoji>,
  ): Promise<void> {
    const content = message.content;
    // Empty for an attachment-only message or when the bot lacks the content intent.
    if (content === null || content === '') return;

    for (const token of this.dictionary.reactionsFor(content).slice(0, MAX_REACTIONS_PER_MESSAGE)) {
      try {
        await message.react(resolveReactionEmoji(message.guild, token));
      } catch (error) {
        const code = discordErrorCode(error);
        // Nothing more can be added to either, so the rest would fail alike.
        if (code === UNKNOWN_MESSAGE || code === MAX_REACTIONS_REACHED) return;
        this.logger.warn(`Reaction failed (${errorLabel(error)})`);
      }
    }
  }
}
