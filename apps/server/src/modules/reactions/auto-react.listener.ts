import { Logger } from '@nestjs/common';
import { Context, On, type ContextOf } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { resolveReactionEmoji } from './emoji-resolver.js';
import { ReactionDictionary } from './reaction-dictionary.js';

/** The message was deleted before the bot could react. */
const UNKNOWN_MESSAGE = 10008;

/**
 * What reacting needs, structurally (see `emoji-resolver.ts`). `content` is
 * null on a message that arrived without its text.
 */
type Reactable<Emoji extends { name: string | null }> = {
  readonly content: string | null;
  readonly guild: Parameters<typeof resolveReactionEmoji<Emoji>>[0];
  react(emoji: Emoji | string): Promise<unknown>;
};

type Edited<Emoji extends { name: string | null }> = Reactable<Emoji> & {
  readonly partial: boolean;
  fetch(): Promise<Reactable<Emoji>>;
};

/**
 * Reacts to "react <emoji>" and to the phrases of the dictionary, on new
 * messages and on edits. Every message counts, the bot's own included.
 *
 * A reaction fails routinely (no permission, an emoji the server does not
 * have, the maximum number of reactions); that is logged and skipped, never
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
  async onMessageUpdate(@Context() [, updated]: ContextOf<'messageUpdate'>): Promise<void> {
    await this.reactToEdit(updated);
  }

  /**
   * The typings promise a full message, but an edit of one that was not cached
   * can still arrive without its text; it is read first.
   */
  private async reactToEdit<Emoji extends { name: string | null }>(
    updated: Edited<Emoji>,
  ): Promise<void> {
    if (!updated.partial) {
      await this.react(updated);
      return;
    }
    let full: Reactable<Emoji>;
    try {
      full = await updated.fetch();
    } catch (error) {
      // Deleted again, or unreadable: nothing to react to.
      this.logger.warn(`Could not read an edited message (${errorLabel(error)})`);
      return;
    }
    await this.react(full);
  }

  private async react<Emoji extends { name: string | null }>(
    message: Reactable<Emoji>,
  ): Promise<void> {
    const content = message.content;
    // Empty for an attachment-only message or when the bot lacks the content intent.
    if (content === null || content === '') return;

    for (const token of this.dictionary.reactionsFor(content)) {
      try {
        await message.react(resolveReactionEmoji(message.guild, token));
      } catch (error) {
        if (discordErrorCode(error) === UNKNOWN_MESSAGE) return;
        this.logger.warn(`Reaction failed (${errorLabel(error)})`);
      }
    }
  }
}
