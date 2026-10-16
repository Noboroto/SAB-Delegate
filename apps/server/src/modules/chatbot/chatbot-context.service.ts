import { Injectable, Logger } from '@nestjs/common';
import { CHATBOT_CONTEXT_LINE_MAX_CHARS, CHATBOT_CONTEXT_MESSAGES } from '@sab/shared';
import type { Message } from 'discord.js';
import { clipText } from './chatbot-prompt.js';
import { describeFailure, type loadAttachments } from './chatbot-attachments.js';
import { lookupDisplayNames } from './chatbot-member-names.js';

const NO_CONTENT = '(không có nội dung)';

type AttachmentSource = Parameters<typeof loadAttachments>[0][number];

type SourceUser = { id: string; bot: boolean; displayName: string };

/** What the context reads of a channel message; a real `Message<true>` is assignable (see `collect`). */
type SourceMessage = {
  id: string;
  cleanContent: string;
  createdAt: Date;
  author: SourceUser;
  member: { displayName: string } | null;
  attachments: { values(): Iterable<AttachmentSource> };
};

type TriggerMessage = SourceMessage & {
  reference: { messageId?: string } | null;
  fetchReference(): Promise<SourceMessage>;
  guild: {
    name: string;
    members: {
      cache: { get(id: string): { displayName: string } | undefined };
      me: { displayName: string } | null;
      fetch(options: {
        user: string[];
        time: number;
      }): Promise<{ values(): Iterable<{ id: string; displayName: string }> }>;
    };
  };
  channel: {
    name: string;
    messages: {
      fetch(options: {
        limit: number;
        before: string;
      }): Promise<{ values(): Iterable<SourceMessage> }>;
    };
  };
  client: { user: { id: string; displayName: string } };
};

type Line = {
  id: string;
  authorId: string;
  authorName: string;
  /** `self` is the bot's own earlier message, `bot` any other bot. */
  role: 'member' | 'bot' | 'self';
  at: string;
  text: string;
};

function attachmentTag(source: AttachmentSource): string {
  const isImage = source.contentType?.startsWith('image/') === true;
  return `[${isImage ? 'ảnh' : 'tệp'}: ${source.name.replace(/\s+/gu, ' ')}]`;
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Reads what the model needs from Discord for one reply: the messages before
 * the one that mentioned the bot, who wrote them, the message it replies to and
 * the files attached to both. Nothing is stored. A Discord failure leaves that
 * part out (the reply goes on with less context); `collect` never throws.
 */
@Injectable()
export class ChatbotContextService {
  private readonly logger = new Logger(ChatbotContextService.name);

  /** `Message<true>` is the only caller; the structural parameter keeps specs free of discord.js classes. */
  async collect(message: Message<true>) {
    return this.collectFrom(message);
  }

  async collectFrom(message: TriggerMessage) {
    const { guild, channel } = message;
    const botId = message.client.user.id;
    const botName = guild.members.me?.displayName ?? message.client.user.displayName;

    const [history, replied] = await Promise.all([
      this.fetchHistory(message),
      this.fetchReplied(message),
    ]);

    const names = await this.resolveNames(
      guild.members,
      [...history, ...(replied === null ? [] : [replied]), message],
      botId,
      botName,
    );
    const nameOf = (source: SourceMessage) =>
      source.author.id === botId
        ? botName
        : (names.get(source.author.id) ?? source.author.displayName);
    const toLine = (source: SourceMessage): Line => {
      const tags = [...source.attachments.values()].map(attachmentTag);
      return {
        id: source.id,
        authorId: source.author.id,
        authorName: nameOf(source),
        role: source.author.id === botId ? 'self' : source.author.bot ? 'bot' : 'member',
        at: source.createdAt.toISOString(),
        text: clipText(
          collapse([source.cleanContent, ...tags].join(' ')),
          CHATBOT_CONTEXT_LINE_MAX_CHARS,
        ),
      };
    };

    // Without a text and without a file there is nothing to show (a deleted
    // or system message that left only an empty shell).
    const lines = history
      .filter(
        (source) =>
          source.cleanContent.trim() !== '' || [...source.attachments.values()].length > 0,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toLine);

    const mention = `@${botName}`;
    const triggerText = message.cleanContent.split(mention).join('').trim();

    return {
      botId,
      botName,
      guildName: guild.name,
      channelName: channel.name,
      speaker: { id: message.author.id, name: nameOf(message) },
      triggerMessageId: message.id,
      triggerText: triggerText === '' ? NO_CONTENT : triggerText,
      messages: lines,
      replied: replied === null ? null : toLine(replied),
      // The trigger's files first: when the cap bites, the replied-to ones lose.
      attachments: [
        ...message.attachments.values(),
        ...(replied === null ? [] : [...replied.attachments.values()]),
      ],
    };
  }

  private async fetchHistory(message: TriggerMessage): Promise<SourceMessage[]> {
    try {
      const page = await message.channel.messages.fetch({
        limit: CHATBOT_CONTEXT_MESSAGES,
        before: message.id,
      });
      return [...page.values()];
    } catch (error) {
      // Missing access (50001) or a vanished channel: answer without the transcript.
      this.logger.warn(`Channel history unavailable (${describeFailure(error)})`);
      return [];
    }
  }

  private async fetchReplied(message: TriggerMessage): Promise<SourceMessage | null> {
    if (message.reference?.messageId === undefined) return null;
    try {
      return await message.fetchReference();
    } catch (error) {
      // The replied-to message was deleted (10008) or is out of reach.
      this.logger.warn(`Replied message unavailable (${describeFailure(error)})`);
      return null;
    }
  }

  /**
   * Display names by author id: the member the message carries, else the
   * cached one, else one batched lookup for everyone still unknown. A failed
   * lookup leaves those authors to their global name or username.
   */
  private async resolveNames(
    members: TriggerMessage['guild']['members'],
    sources: SourceMessage[],
    botId: string,
    botName: string,
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>([[botId, botName]]);
    const unknown = new Set<string>();
    for (const source of sources) {
      const id = source.author.id;
      if (names.has(id)) continue;
      const known = source.member?.displayName;
      if (known === undefined) unknown.add(id);
      else names.set(id, known);
    }
    const found = await lookupDisplayNames(members, unknown, (error) => {
      this.logger.warn(`Member lookup failed (${describeFailure(error)})`);
    });
    for (const [id, name] of found) names.set(id, name);
    return names;
  }
}
