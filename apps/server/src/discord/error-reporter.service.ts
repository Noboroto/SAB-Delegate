import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Client } from 'discord.js';
import { SECRET_ENV_NAMES } from '../config/env.js';
import { errorLabel } from '../prisma/pool-factory.js';
import { DISCORD_ENV, type DiscordEnv } from './boot-guard.js';

/** The channel, by name, that receives runtime errors in the admin guild. */
export const BOT_LOG_CHANNEL_NAME = 'bot-log';
// Discord rejects a message over 2000 characters; the fence needs the rest.
const MAX_DETAIL_LENGTH = 1900;
const MAX_TITLE_LENGTH = 200;

type OutgoingMessage = { content: string; allowedMentions: { parse: readonly [] } };
type LogChannelPort = { send(message: OutgoingMessage): Promise<unknown> };
type ReporterEnv = Pick<DiscordEnv, 'ADMIN_GUILD_ID' | (typeof SECRET_ENV_NAMES)[number]>;

// A stack trace can contain user-controlled text (an option value, a message
// body). Mentions in it must not ping anyone.
const NO_MENTIONS: OutgoingMessage['allowedMentions'] = { parse: [] };
type ClientPort = {
  guilds: {
    cache: {
      get(id: string):
        | {
            channels: {
              cache: {
                find(
                  predicate: (channel: { name: string; isTextBased(): boolean }) => boolean,
                ): unknown;
              };
            };
          }
        | undefined;
    };
  };
};

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
  try {
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

/**
 * Posts runtime errors to `#bot-log` of the admin guild and to the process log.
 * The report is the only place the real error text goes: the person who ran the
 * command is told a generic sentence.
 */
@Injectable()
export class ErrorReporter implements OnModuleDestroy {
  private readonly logger = new Logger(ErrorReporter.name);
  private shuttingDown = false;

  constructor(
    @Inject(Client) private readonly client: ClientPort,
    @Inject(DISCORD_ENV) private readonly env: ReporterEnv,
  ) {}

  /**
   * While the process is stopping the gateway is being closed: a send would
   * fail and its failure would hide the shutdown, so only the log is written.
   */
  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  /** Never throws: a failing report must not break the handler that is reporting. */
  async report(title: string, error: unknown): Promise<void> {
    const detail = this.redact(describeError(error));
    this.logger.error(`${title}\n${detail}`);
    if (this.shuttingDown) return;

    try {
      const channel = this.findLogChannel();
      if (channel === undefined) return;
      await channel.send({
        content: title.slice(0, MAX_TITLE_LENGTH),
        allowedMentions: NO_MENTIONS,
      });
      // Fence-safe before the cut: neutralising adds characters.
      const fenced = breakFences(detail).slice(0, MAX_DETAIL_LENGTH);
      await channel.send({ content: '```\n' + fenced + '\n```', allowedMentions: NO_MENTIONS });
    } catch (reportFailure) {
      this.logger.warn(`Could not post to #${BOT_LOG_CHANNEL_NAME} (${errorLabel(reportFailure)})`);
    }
  }

  // Only the admin guild's channel counts: a same-named channel elsewhere would
  // leak stack traces to people who should not see them.
  private findLogChannel(): LogChannelPort | undefined {
    const channel = this.client.guilds.cache
      .get(this.env.ADMIN_GUILD_ID)
      ?.channels.cache.find(
        (candidate) => candidate.name === BOT_LOG_CHANNEL_NAME && candidate.isTextBased(),
      );
    return isLogChannel(channel) ? channel : undefined;
  }

  private redact(text: string): string {
    // A library error can echo the request that failed or the connection
    // string; keep every secret out of a channel and a log that more people
    // can read than the environment. The URL-encoded form is what a database
    // URL carries.
    let redacted = text;
    for (const name of SECRET_ENV_NAMES) {
      const value = this.env[name];
      if (value === '') continue;
      for (const form of new Set([value, encodeURIComponent(value)])) {
        redacted = redacted.replaceAll(form, '[redacted]');
      }
    }
    return redacted;
  }
}

/** Puts a zero-width space between the backticks of any run of three or more, so the text cannot close the code fence it is posted in. */
function breakFences(text: string): string {
  return text.replaceAll(/`{3,}/g, (run) => [...run].join('\u200b'));
}

function isLogChannel(value: unknown): value is LogChannelPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LogChannelPort).send === 'function'
  );
}
