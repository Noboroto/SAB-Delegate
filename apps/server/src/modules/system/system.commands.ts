import { Context, SlashCommand, type SlashCommandContext } from 'necord';
import { rootCommandMeta } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { SystemService } from './system.service.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Whole days, hours and minutes of an uptime; seconds are noise at this scale. */
function splitUptime(uptimeMs: number): { days: number; hours: number; minutes: number } {
  return {
    days: Math.floor(uptimeMs / DAY_MS),
    hours: Math.floor((uptimeMs % DAY_MS) / HOUR_MS),
    minutes: Math.floor((uptimeMs % HOUR_MS) / MINUTE_MS),
  };
}

@DiscordCommands()
export class SystemCommands {
  constructor(
    private readonly system: SystemService,
    private readonly locales: GuildLocaleService,
  ) {}

  @SlashCommand(rootCommandMeta('ping'))
  async ping(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));

    // The reply's own timestamp against the interaction's is what the user
    // waited for: the real round trip through Discord, not a local clock.
    const { resource } = await interaction.reply({
      content: t('system.ping.pinging'),
      withResponse: true,
    });
    const roundtripMs = resource?.message
      ? resource.message.createdTimestamp - interaction.createdTimestamp
      : undefined;

    const { uptimeMs, wsPing } = this.system.getStatus();
    const milliseconds = (value: number | undefined): string =>
      value === undefined || value < 0
        ? t('system.ping.unavailable')
        : t('system.ping.milliseconds', { value });

    await interaction.editReply({
      content: t('system.ping.reply', {
        uptime: t('system.ping.uptime', splitUptime(uptimeMs)),
        wsPing: milliseconds(wsPing),
        roundtrip: milliseconds(roundtripMs),
      }),
    });
  }
}
