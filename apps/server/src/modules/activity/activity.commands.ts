import {
  ACTIVITY_EMOJI_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
  ACTIVITY_SHORT_NAME_LENGTH,
  ErrorCode,
  type ActorContext,
} from '@sab/shared';
import { ChannelType } from 'discord.js';
import {
  ChannelOption,
  Context,
  Options,
  SlashCommand,
  StringOption,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { rootCommandMeta } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { ActivityService } from './activity.service.js';

const emojiText = localizations('activity.commands.emojiOption.description');
const nameText = localizations('activity.commands.nameOption.description');
const shortNameText = localizations('activity.commands.shortNameOption.description');
const categoryText = localizations('activity.commands.categoryOption.description');

/**
 * The numbered option names are the ones the previous bot registered, so
 * people's habits and saved shortcuts keep working; `category` is the only
 * addition, and it is optional.
 */
export class CreateActivityOptions {
  @StringOption({
    name: '1-emoji',
    description: emojiText['en-US'],
    description_localizations: emojiText,
    required: true,
    max_length: ACTIVITY_EMOJI_MAX_LENGTH,
  })
  readonly emoji!: string;

  @StringOption({
    name: '2-name',
    description: nameText['en-US'],
    description_localizations: nameText,
    required: true,
    max_length: ACTIVITY_NAME_MAX_LENGTH,
  })
  readonly name!: string;

  @StringOption({
    name: '3-short-name',
    description: shortNameText['en-US'],
    description_localizations: shortNameText,
    required: true,
    min_length: ACTIVITY_SHORT_NAME_LENGTH,
    max_length: ACTIVITY_SHORT_NAME_LENGTH,
  })
  readonly shortName!: string;

  @ChannelOption({
    name: 'category',
    description: categoryText['en-US'],
    description_localizations: categoryText,
    channel_types: [ChannelType.GuildCategory],
    required: false,
  })
  // discord.js answers null for an option the person left out.
  readonly category?: { readonly id: string } | null;
}

/**
 * `/create-activity`. Who may run it is decided by Discord's default command
 * permission; nothing is checked here. The answer is public: the room should
 * see what was made.
 */
@DiscordCommands()
export class ActivityCommands {
  constructor(
    private readonly activities: ActivityService,
    private readonly locales: GuildLocaleService,
  ) {}

  @SlashCommand(rootCommandMeta('create-activity'))
  async onCreate(
    @Context() [interaction]: SlashCommandContext,
    @Options() { emoji, name, shortName, category }: CreateActivityOptions,
  ): Promise<void> {
    // The command is registered for servers only; this guards the type and a stale registration.
    const guildId = interaction.guildId;
    if (guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    // Settled before anything is deferred or created, so the refusal is a
    // quick private answer and no role is made for nothing.
    const categoryId = await this.activities.resolveCategoryId(guildId, category?.id);
    if (categoryId === null) {
      await replyInChunks(interaction, t('activity.noCategory'), { ephemeral: true });
      return;
    }

    // Six Discord calls in a row outlast the 3 s window for a first reply.
    await interaction.deferReply();
    const actor: ActorContext = { source: 'DISCORD', userId: interaction.user.id };
    const result = await this.activities.createActivity(
      guildId,
      { emoji, name, shortName, categoryId },
      actor,
    );

    await replyInChunks(
      interaction,
      t('activity.created', {
        name: name.trim(),
        roles: Object.values(result.roles)
          .map((id) => `<@&${id}>`)
          .join(', '),
        general: `<#${result.channels.general}>`,
        threadOnly: `<#${result.channels.threadOnly}>`,
        voice: `<#${result.channels.voice}>`,
      }),
    );
  }
}
