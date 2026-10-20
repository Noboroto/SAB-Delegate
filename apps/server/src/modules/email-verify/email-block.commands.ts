import { EMAIL_BLOCK_PATTERNS_MAX, EmailBlocklistSchema } from '@sab/shared';
import { Context, StringOption, Subcommand, type SlashCommandContext } from 'necord';
import { EmailBlockGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { Options } from '../../discord/decorators/options.decorator.js';
import { showResult } from '../../discord/helpers/confirm-buttons.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import {
  NO_PING,
  PRIVATE,
  actorOf,
  confirmed,
  guildOf,
  optionMeta,
  splitItems,
  subcommandMeta,
} from './email-verify.command-support.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';

/** Several patterns fit one option; this is the longest text Discord takes for it. */
const PATTERNS_OPTION_MAX = 6000;

class PatternsOptions {
  @StringOption({
    name: 'patterns',
    ...optionMeta('patterns'),
    required: true,
    min_length: 1,
    max_length: PATTERNS_OPTION_MAX,
  })
  readonly patterns!: string;
}

/**
 * The patterns typed in an option, lower-cased and without repeats, or `null`
 * when one of them is not a pattern the blocklist takes.
 */
function patternsOf(text: string): string[] | null {
  const items = [...new Set(splitItems(text, /[\s,;]+/).map((item) => item.toLowerCase()))];
  if (items.length === 0) return null;
  for (const item of items) {
    if (!EmailBlocklistSchema.safeParse({ patterns: [item] }).success) return null;
  }
  return items;
}

/**
 * `/email-block add|remove|list|clear`: address patterns (`*@mailinator.com`)
 * that cannot verify, whatever the access rules say. Who may run them is
 * decided by the group's default permission in Discord; nothing is checked
 * here. Answers are private.
 */
@DiscordCommands()
@EmailBlockGroup()
export class EmailBlockCommands {
  constructor(
    private readonly config: EmailVerifyConfigService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand(subcommandMeta('emailBlock.add', 'add'))
  async onAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { patterns }: PatternsOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const wanted = patternsOf(patterns);
    if (wanted === null) {
      await replyInChunks(interaction, t('email-verify.block.invalid'), { ephemeral: true });
      return;
    }
    const current = (await this.config.blocklist(guildId)).patterns;
    const fresh = wanted.filter((pattern) => !current.includes(pattern));
    if (current.length + fresh.length > EMAIL_BLOCK_PATTERNS_MAX) {
      await replyInChunks(
        interaction,
        t('email-verify.block.limit', { max: EMAIL_BLOCK_PATTERNS_MAX }),
        { ephemeral: true },
      );
      return;
    }
    if (fresh.length > 0) {
      await this.config.setBlocklist(
        guildId,
        { patterns: [...current, ...fresh] },
        actorOf(interaction),
      );
    }
    await replyInChunks(interaction, t('email-verify.block.added', { count: fresh.length }), {
      ephemeral: true,
    });
  }

  @Subcommand(subcommandMeta('emailBlock.remove', 'remove'))
  async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { patterns }: PatternsOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const wanted = new Set(splitItems(patterns).map((item) => item.toLowerCase()));
    const current = (await this.config.blocklist(guildId)).patterns;
    const kept = current.filter((pattern) => !wanted.has(pattern));
    if (kept.length === current.length) {
      await replyInChunks(interaction, t('email-verify.block.notFound'), { ephemeral: true });
      return;
    }
    await this.config.setBlocklist(guildId, { patterns: kept }, actorOf(interaction));
    await replyInChunks(interaction, t('email-verify.block.removed'), { ephemeral: true });
  }

  @Subcommand(subcommandMeta('emailBlock.list', 'list'))
  async onList(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { patterns } = await this.config.blocklist(guildId);
    const text =
      patterns.length === 0
        ? t('email-verify.block.listEmpty')
        : [`**${t('email-verify.block.listTitle')}**`, ...patterns.map((p) => `- \`${p}\``)].join(
            '\n',
          );
    await replyInChunks(interaction, text, { ephemeral: true, allowedMentions: NO_PING });
  }

  @Subcommand(subcommandMeta('emailBlock.clear', 'clear'))
  async onClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { patterns } = await this.config.blocklist(guildId);
    if (patterns.length === 0) {
      await showResult(interaction, t('email-verify.block.listEmpty'));
      return;
    }
    const prompt = t('email-verify.confirm.blockClear', { count: patterns.length });
    if (!(await confirmed(interaction, t, prompt))) return;

    await this.config.setBlocklist(guildId, { patterns: [] }, actorOf(interaction));
    await showResult(interaction, t('email-verify.block.cleared'));
  }
}
