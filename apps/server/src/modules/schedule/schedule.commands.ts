import { UseInterceptors } from '@nestjs/common';
import {
  ErrorCode,
  MESSAGE_MAX_LENGTH,
  MessageRefFailureSchema,
  formatDiscordTimestamp,
  formatWhenIct,
  parseWhen,
  type ActorContext,
  type ParseWhenError,
  type ScheduleCreateResult,
} from '@sab/shared';
import {
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ApplicationCommandOptionAllowedChannelType,
} from 'discord.js';
import {
  ChannelOption,
  Context,
  Modal,
  ModalParam,
  Options,
  StringOption,
  Subcommand,
  type ModalContext,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { BotMessageGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { showModalFirst } from '../../discord/helpers/modal.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { ScheduleWhenAutocompleteInterceptor } from './schedule.autocomplete.js';
import { ScheduleService } from './schedule.service.js';

const sendText = localizations('schedule.commands.send.description');
const copyText = localizations('schedule.commands.copy.description');
const messageText = localizations('schedule.commands.messageOption.description');
const messageLinkText = localizations('schedule.commands.messageLinkOption.description');
const timeText = localizations('schedule.commands.timeOption.description');
const dateText = localizations('schedule.commands.dateOption.description');
const destinationText = localizations('schedule.commands.destinationOption.description');

const DESTINATION_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

/** What the person typed in `time` and `date` is short; a longer value is a mistake Discord can refuse. */
const WHEN_MAX_LENGTH = 100;

type DestinationRef = { readonly id: string; readonly guildId: string };

// The options are spelled once and used by both subcommands. They are not a
// shared base class: Necord lists a derived class's options before its base's,
// and Discord refuses a required option that follows an optional one.
const timeOption = () =>
  StringOption({
    name: 'time',
    description: timeText['en-US'],
    description_localizations: timeText,
    required: true,
    autocomplete: true,
    max_length: WHEN_MAX_LENGTH,
  });

const dateOption = () =>
  StringOption({
    name: 'date',
    description: dateText['en-US'],
    description_localizations: dateText,
    required: false,
    autocomplete: true,
    max_length: WHEN_MAX_LENGTH,
  });

const destinationOption = () =>
  ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: DESTINATION_TYPES,
    required: false,
  });

export class ScheduleSendOptions {
  @timeOption()
  readonly time!: string;

  /** Left out, the command opens a dialog for the text instead. */
  @StringOption({
    name: 'message',
    description: messageText['en-US'],
    description_localizations: messageText,
    required: false,
    min_length: 1,
    max_length: MESSAGE_MAX_LENGTH,
  })
  readonly message?: string | null;

  @dateOption()
  readonly date?: string | null;

  @destinationOption()
  readonly destination?: DestinationRef | null;
}

export class ScheduleCopyOptions {
  @StringOption({
    name: 'message-link',
    description: messageLinkText['en-US'],
    description_localizations: messageLinkText,
    required: true,
  })
  readonly messageLink!: string;

  @timeOption()
  readonly time!: string;

  @dateOption()
  readonly date?: string | null;

  @destinationOption()
  readonly destination?: DestinationRef | null;
}

type Answerable = Parameters<typeof replyInChunks>[0] & { readonly locale: string };

/** The id of the dialog `schedule-send` opens; the channel and the moment ride along. */
const SEND_MODAL_PREFIX = 'schedule-send';
const MESSAGE_INPUT = 'message';

/**
 * `/bot-message schedule-send|schedule-copy`. The rest of the `bot-message`
 * group lives in the messaging module; both declare the group the same way.
 * Who may run them is decided by the group's default permission in Discord;
 * nothing is checked here. The commands turn options into service calls and
 * results into replies, always privately.
 *
 * The time is `time` plus an optional `date`, both text with suggestions; the
 * six numeric options of the previous bot are gone. It is read and checked
 * before anything is answered, so a dialog can still be the first response.
 */
@DiscordCommands()
@BotMessageGroup()
export class ScheduleCommands {
  constructor(
    private readonly schedules: ScheduleService,
    private readonly locales: GuildLocaleService,
  ) {}

  @UseInterceptors(ScheduleWhenAutocompleteInterceptor)
  @Subcommand({
    name: 'schedule-send',
    description: sendText['en-US'],
    descriptionLocalizations: sendText,
  })
  async onScheduleSend(
    @Context() [interaction]: SlashCommandContext,
    @Options() { time, message, date, destination }: ScheduleSendOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const at = await this.readWhen(interaction, guildId, time, date);
    if (at === undefined) return;
    const channelId = destination?.id ?? interaction.channelId;

    if (message === undefined || message === null) {
      // A dialog must be the first response, so nothing is deferred or read
      // before it. Its language is the invoker's own, which needs no lookup.
      await showModalFirst(interaction, buildSendModal(interaction.locale, channelId, at));
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.schedules.scheduleSend(
      destination?.guildId ?? guildId,
      { channelId, content: message, runAt: at },
      actorOf(interaction),
    );
    await this.confirm(interaction, guildId, result);
  }

  /** The dialog `schedule-send` opened. */
  @Modal(`${SEND_MODAL_PREFIX}/:channelId/:unix`)
  async onScheduleSendModal(
    @Context() [interaction]: ModalContext,
    @ModalParam('channelId') channelId: string,
    @ModalParam('unix') unix: string,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const content = interaction.fields.getTextInputValue(MESSAGE_INPUT);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // The moment was fixed when the command ran; the dialog may have stayed
    // open past it.
    const at = new Date(Number(unix) * 1000);
    if (!/^\d{1,12}$/.test(unix) || at.getTime() <= Date.now()) {
      const t = translatorFor(await this.locales.resolve(guildId, interaction));
      const input = Number.isNaN(at.getTime()) ? unix : formatWhenIct(at);
      await replyInChunks(interaction, t('schedule.when.PAST', { input }), { ephemeral: true });
      return;
    }

    const result = await this.schedules.scheduleSend(
      guildId,
      { channelId, content, runAt: at },
      actorOf(interaction),
    );
    await this.confirm(interaction, guildId, result);
  }

  @UseInterceptors(ScheduleWhenAutocompleteInterceptor)
  @Subcommand({
    name: 'schedule-copy',
    description: copyText['en-US'],
    descriptionLocalizations: copyText,
  })
  async onScheduleCopy(
    @Context() [interaction]: SlashCommandContext,
    @Options() { messageLink, time, date, destination }: ScheduleCopyOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const at = await this.readWhen(interaction, guildId, time, date);
    if (at === undefined) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await this.schedules.scheduleCopy(
        destination?.guildId ?? guildId,
        {
          channelId: destination?.id ?? interaction.channelId,
          source: messageLink,
          sourceChannelId: interaction.channelId,
          runAt: at,
        },
        actorOf(interaction),
      );
      await this.confirm(interaction, guildId, result);
    } catch (error) {
      // A link that cannot be read is told apart from a generic bad value.
      const reason = linkFailureOf(error);
      if (reason === undefined) throw error;
      const t = translatorFor(await this.locales.resolve(guildId, interaction));
      await replyInChunks(interaction, t(`errors.invalidLink.${reason}`), { ephemeral: true });
    }
  }

  /**
   * The moment the person asked for, or `undefined` after telling them why it
   * cannot be used. Answers with a reply (not a deferral) so the dialog of
   * `schedule-send` stays possible for the valid case.
   */
  private async readWhen(
    interaction: SlashCommandContext[0],
    guildId: string,
    time: string,
    date: string | null | undefined,
  ): Promise<Date | undefined> {
    const result = parseWhen({ time, date }, new Date());
    if ('at' in result) return result.at;

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t(`schedule.when.${result.error}`, { input: offendingText(result.error, time, date) }),
      { ephemeral: true },
    );
    return undefined;
  }

  private async confirm(
    interaction: Answerable,
    guildId: string,
    result: ScheduleCreateResult,
  ): Promise<void> {
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const seq = result.schedule?.seq;
    if (seq === undefined) throw new Error('A scheduled message was reported without its row');
    await replyInChunks(
      interaction,
      t('schedule.created', { seq, when: formatDiscordTimestamp(result.runAt) }),
      { ephemeral: true },
    );
  }
}

/** The part of the input a refusal is about, so the message can quote it. */
function offendingText(
  error: ParseWhenError,
  time: string,
  date: string | null | undefined,
): string {
  switch (error) {
    case 'INVALID_TIME':
      return time;
    case 'INVALID_DATE':
    case 'NONEXISTENT_DATE':
      return date ?? '';
    default:
      return [time, date]
        .filter((part) => part !== undefined && part !== null && part !== '')
        .join(' ');
  }
}

/** The commands are offered in direct messages too (see AGENTS.md); there is no schedule there. */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/** Set only when `error` says the message link could not be read. */
function linkFailureOf(error: unknown) {
  if (!(error instanceof ServiceError) || error.code !== ErrorCode.VALIDATION_FAILED) {
    return undefined;
  }
  const reason = MessageRefFailureSchema.safeParse(error.params?.['reason']);
  return reason.success ? reason.data : undefined;
}

function buildSendModal(locale: string, channelId: string, at: Date): ModalBuilder {
  const t = translatorFor(locale);
  const input = new TextInputBuilder()
    .setCustomId(MESSAGE_INPUT)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(MESSAGE_MAX_LENGTH);
  return new ModalBuilder()
    .setCustomId(`${SEND_MODAL_PREFIX}/${channelId}/${Math.floor(at.getTime() / 1000)}`)
    .setTitle(t('schedule.modal.title'))
    .addLabelComponents(
      new LabelBuilder().setLabel(t('schedule.modal.label')).setTextInputComponent(input),
    );
}
