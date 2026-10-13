import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Client } from 'discord.js';
import { errorLabel } from '../prisma/pool-factory.js';
import { DISCORD_ENV, type DiscordEnv } from './boot-guard.js';

/** The channel, by name, that receives runtime errors in the admin guild. */
export const BOT_LOG_CHANNEL_NAME = 'bot-log';
// Discord rejects a message over 2000 characters; the fence needs the rest.
const MAX_DETAIL_LENGTH = 1900;
const MAX_TITLE_LENGTH = 200;

type LogChannelPort = { send(message: { content: string }): Promise<unknown> };
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
    @Inject(DISCORD_ENV) private readonly env: Pick<DiscordEnv, 'ADMIN_GUILD_ID' | 'DISCORD_TOKEN'>,
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
      await channel.send({ content: title.slice(0, MAX_TITLE_LENGTH) });
      await channel.send({ content: '```\n' + detail.slice(0, MAX_DETAIL_LENGTH) + '\n```' });
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
    // A library error can echo the request that failed; keep the token out of
    // a channel and a log that more people can read than the environment.
    return text.replaceAll(this.env.DISCORD_TOKEN, '[redacted]');
  }
}

function isLogChannel(value: unknown): value is LogChannelPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LogChannelPort).send === 'function'
  );
}
