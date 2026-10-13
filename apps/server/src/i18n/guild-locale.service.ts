import { Injectable, Logger, Module } from '@nestjs/common';
import { resolveLocale, type Locale } from '@sab/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The parts of a Discord interaction that say what language to answer in. Typed
 * structurally so this module needs nothing from discord.js and any interaction
 * (command, autocomplete, modal) fits.
 */
type LocaleHints = {
  /** The invoking user's client language. */
  locale?: string | null;
  guild?: { preferredLocale?: string | null } | null;
  /** The guild's preferred language as Discord sent it with the interaction. */
  guildLocale?: string | null;
};

/** Decides which language a reply to a guild is written in. */
@Injectable()
export class GuildLocaleService {
  private readonly logger = new Logger(GuildLocaleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The language the guild stored, else the invoker's client language, else the
   * guild's preferred language, else Vietnamese. A guild row always carries a
   * language (the column defaults to Vietnamese), so the interaction hints only
   * decide for a guild the bot has not recorded yet.
   *
   * Never throws: the reply (often the error reply) must still go out when the
   * lookup fails, and then the hints decide.
   */
  async resolve(guildId: string | null | undefined, interaction?: LocaleHints): Promise<Locale> {
    const stored = guildId ? await this.storedLocale(guildId) : undefined;
    return resolveLocale([
      stored,
      interaction?.locale,
      interaction?.guild?.preferredLocale,
      interaction?.guildLocale,
    ]);
  }

  private async storedLocale(guildId: string): Promise<string | undefined> {
    try {
      const row = await this.prisma.guild.findUnique({
        where: { discordId: guildId },
        select: { locale: true },
      });
      return row?.locale;
    } catch (error) {
      this.logger.warn(
        `Guild language lookup failed (${error instanceof Error ? error.name : 'unknown error'})`,
      );
      return undefined;
    }
  }
}

@Module({
  providers: [GuildLocaleService],
  exports: [GuildLocaleService],
})
export class I18nModule {}
