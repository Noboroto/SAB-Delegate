import { Injectable, Logger } from '@nestjs/common';
import { BUSINESS_TIME_ZONE, CHATBOT_PROVIDER_PAUSE_MS } from '@sab/shared';
import { BOT_LOG_CHANNEL_NAME } from '../../discord/error-reporter.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';

/** One paused model: a server's own endpoint (`guildId` set) or the shared one (`null`). */
/** `probe`: ticket of the one call let through after the window, until its outcome is known. */
type Outage = { until: number; probe: number | null; guildId: string | null };

/** Ticket of a call admitted while no outage ran. */
const NO_PROBE = 0;

function isProbe(outage: Outage, ticket: number): boolean {
  return ticket !== NO_PROBE && outage.probe === ticket;
}

type AlertClient = { guilds: { cache: { get(id: string): unknown } } };
type AlertGuild = {
  name?: unknown;
  channels: {
    cache: {
      find(predicate: (channel: { name: string; isTextBased(): boolean }) => boolean): unknown;
    };
  };
};
type LogChannel = { send(options: object): Promise<unknown> };

const HOUR_MINUTE = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const EMBED_COLOR = 0xed4245;
const FIELD_MAX_LENGTH = 1000;

/**
 * Identifies one model and key without holding the key: its last four
 * characters tell two keys of one endpoint apart. A server's own endpoint is
 * its own entry even when another server uses the same address and key, because
 * each of them has to be told and each recovers on its own.
 */
export function pauseKeyOf(
  guildId: string | null,
  baseUrl: string,
  model: string,
  keyLast4: string,
): string {
  return [guildId ?? 'global', baseUrl.replace(/\/+$/u, ''), model, keyLast4].join('\n');
}

function isLogChannel(value: unknown): value is LogChannel {
  return (
    typeof value === 'object' && value !== null && typeof (value as LogChannel).send === 'function'
  );
}

function clip(text: string): string {
  return text.slice(0, FIELD_MAX_LENGTH);
}

/**
 * Remembers which models their provider has run out of credit for, so a
 * member's message is answered at once instead of paying a call that is sure
 * to fail. In memory on purpose: a restart simply tries the provider again.
 *
 * After the window one call is let through (half-open). It clears the outage
 * when it works and renews the window when the provider still refuses. The
 * outage is one, from the first refusal to the first success, so the admins are
 * told once.
 */
@Injectable()
export class ChatbotPauseService {
  private readonly logger = new Logger(ChatbotPauseService.name);
  private readonly outages = new Map<string, Outage>();
  private nextProbe = 0;

  /**
   * A ticket for a call to the model, or `null` when the call must not go. No
   * outage: ticket `NO_PROBE`. Right after the window: one probe ticket, the
   * only one that can end or renew the outage. The outcome must be reported
   * back with the same ticket.
   */
  admit(key: string): number | null {
    const outage = this.outages.get(key);
    if (outage === undefined) return NO_PROBE;
    if (Date.now() < outage.until || outage.probe !== null) return null;
    this.nextProbe += 1;
    outage.probe = this.nextProbe;
    return outage.probe;
  }

  /**
   * The provider refused for lack of credit. `started` is true only for the
   * first refusal of an outage: that one alone is worth an alert. Only the
   * current probe renews the window; a call admitted before the outage that
   * ends now says nothing new about it.
   */
  trip(key: string, guildId: string | null, ticket: number): { started: boolean; until: Date } {
    const now = Date.now();
    const outage = this.outages.get(key);
    if (outage === undefined) {
      const until = now + CHATBOT_PROVIDER_PAUSE_MS;
      this.outages.set(key, { until, probe: null, guildId });
      return { started: true, until: new Date(until) };
    }
    if (isProbe(outage, ticket)) {
      outage.until = now + CHATBOT_PROVIDER_PAUSE_MS;
      outage.probe = null;
    }
    return { started: false, until: new Date(outage.until) };
  }

  /** A call to the model worked. Only the current probe's success ends the outage. */
  succeed(key: string, ticket: number): void {
    const outage = this.outages.get(key);
    if (outage !== undefined && isProbe(outage, ticket)) this.outages.delete(key);
  }

  /** A call ended for another reason: the outage stays, and the next call after the window may probe. */
  release(key: string, ticket: number): void {
    const outage = this.outages.get(key);
    if (outage !== undefined && isProbe(outage, ticket)) outage.probe = null;
  }

  /** The window's end while it still runs; `null` once it has passed. */
  pausedUntil(key: string): Date | null {
    const outage = this.outages.get(key);
    return outage !== undefined && Date.now() < outage.until ? new Date(outage.until) : null;
  }

  clear(key: string): void {
    this.outages.delete(key);
  }

  /** The server changed or removed its own endpoint: whatever was paused is no longer used. */
  clearGuild(guildId: string): void {
    for (const [key, outage] of this.outages) {
      if (outage.guildId === guildId) this.outages.delete(key);
    }
  }

  /** The shared endpoint was saved again: new settings deserve a new try. */
  clearGlobal(): void {
    for (const [key, outage] of this.outages) {
      if (outage.guildId === null) this.outages.delete(key);
    }
  }

  /**
   * Tells the admin guild's `#bot-log` that a model is paused. Names the model
   * and host, never the key or anything the provider said. Never throws: the
   * member's answer must not wait on, or fail with, the alert.
   */
  async announce(
    client: AlertClient,
    adminGuildId: string,
    outage: {
      guildId: string | null;
      baseUrl: string;
      model: string;
      until: Date;
    },
  ): Promise<void> {
    try {
      const channel = this.findLogChannel(client, adminGuildId);
      if (channel === undefined) {
        this.logger.warn(`No #${BOT_LOG_CHANNEL_NAME} to announce a paused chatbot model in`);
        return;
      }
      await channel.send({
        embeds: [
          {
            title: 'Chatbot paused: the LLM provider is out of credit',
            color: EMBED_COLOR,
            fields: [
              { name: 'Source', value: clip(this.sourceLabel(client, outage.guildId)) },
              { name: 'Model', value: clip(outage.model), inline: true },
              { name: 'Host', value: clip(new URL(outage.baseUrl).host), inline: true },
              {
                name: 'Paused until',
                value: `${HOUR_MINUTE.format(outage.until)} (${BUSINESS_TIME_ZONE})`,
              },
            ],
          },
        ],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.warn(`Could not announce a paused chatbot model (${errorLabel(error)})`);
    }
  }

  private sourceLabel(client: AlertClient, guildId: string | null): string {
    if (guildId === null) return 'Shared key';
    const name = (client.guilds.cache.get(guildId) as AlertGuild | undefined)?.name;
    return typeof name === 'string' ? `Server key: ${name} (${guildId})` : `Server key: ${guildId}`;
  }

  // Only the admin guild's channel counts: a same-named channel elsewhere
  // would show the alert to people who should not see it.
  private findLogChannel(client: AlertClient, adminGuildId: string): LogChannel | undefined {
    const guild = client.guilds.cache.get(adminGuildId) as AlertGuild | undefined;
    const channel = guild?.channels.cache.find(
      (candidate) => candidate.name === BOT_LOG_CHANNEL_NAME && candidate.isTextBased(),
    );
    return isLogChannel(channel) ? channel : undefined;
  }
}
