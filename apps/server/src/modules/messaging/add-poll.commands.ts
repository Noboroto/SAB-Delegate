import { POLL_CHOICES_MAX } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import {
  Context,
  IntegerOption,
  Options,
  SlashCommand,
  StringOption,
  type SlashCommandContext,
} from 'necord';
import { rootCommandMeta } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import {
  answerPrivately,
  channelOf,
  resolutionProblem,
  slashActor,
} from './messaging.presenter.js';
import { MessagingService } from './messaging.service.js';

const choiceCountText = localizations('messaging.commands.pollChoiceCountOption.description');
const messageLinkText = localizations('messaging.commands.pollMessageLinkOption.description');

class AddPollOptions {
  @IntegerOption({
    name: 'poll-choice-count',
    description: choiceCountText['en-US'],
    description_localizations: choiceCountText,
    required: true,
    min_value: 1,
    max_value: POLL_CHOICES_MAX,
  })
  readonly pollChoiceCount!: number;

  @StringOption({
    name: 'message-link',
    description: messageLinkText['en-US'],
    description_localizations: messageLinkText,
    required: false,
  })
  readonly messageLink?: string;
}

/**
 * `/add-poll`: numbered reactions on a message, or on a new one posted for the
 * purpose. Offered in servers only; the answer is private.
 */
@DiscordCommands()
export class AddPollCommands {
  constructor(
    private readonly messaging: MessagingService,
    private readonly resolver: MessageResolver,
    private readonly locales: GuildLocaleService,
  ) {}

  @SlashCommand(rootCommandMeta('add-poll'))
  async onAddPoll(
    @Context() [interaction]: SlashCommandContext,
    @Options() { pollChoiceCount, messageLink }: AddPollOptions,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const channelId = channelOf(interaction);

    let messageId: string | undefined;
    let pollChannelId = channelId;
    if (messageLink !== undefined) {
      const found = await this.resolver.fetch(messageLink, { channelId });
      if (found.status !== 'OK') {
        await replyInChunks(interaction, resolutionProblem(t, found), { ephemeral: true });
        return;
      }
      messageId = found.message.id;
      pollChannelId = found.message.channelId;
    }

    await answerPrivately(interaction, t, 'poll', async () => {
      await this.messaging.createReactionPoll(
        interaction.guildId,
        { channelId: pollChannelId, messageId, choices: pollChoiceCount },
        slashActor(interaction),
      );
      return t('messaging.done');
    });
  }
}
