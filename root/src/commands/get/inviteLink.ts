import {
  ChatInputCommandInteraction,
  ChannelType,
  SlashCommandSubcommandBuilder,
  MessageFlags,
  GuildChannel,
  ThreadChannel,
  TextChannel,
  NewsChannel,
} from "discord.js";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "invite-link";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Get the invite link for this server")
      .addChannelOption((Option) =>
        Option.setName("channel")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.AnnouncementThread)
          .addChannelTypes(ChannelType.PublicThread)
          .addChannelTypes(ChannelType.PrivateThread)
          .setDescription("Default is the current channel")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const optionChannel = interaction.options.getChannel("channel");
    const requested = (
      optionChannel
        ? await interaction.guild.channels.fetch(optionChannel.id)
        : interaction.channel
    ) as GuildChannel | ThreadChannel | null;
    if (!requested) {
      await interaction.editReply("Channel not found!");
      return;
    }

    // Threads cannot hold invites; they belong to the parent channel.
    const targetChannel = (
      requested.isThread() ? requested.parent : requested
    ) as TextChannel | NewsChannel | null;
    if (!targetChannel || typeof targetChannel.createInvite !== "function") {
      await interaction.editReply("Cannot create an invite for that channel!");
      return;
    }

    let inviteUrl: string;
    try {
      const invite = await targetChannel.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: `Requested by ${interaction.user.username}`,
      });
      inviteUrl = invite.url;
    } catch (error) {
      console.error("get invite-link failed to create the invite", error);
      await interaction.editReply(
        `Cannot create the invite: ${errorMessage(error)}`
      );
      return;
    }

    try {
      await interaction.user.send(
        `Invite link for \`${targetChannel.name}\` is ${inviteUrl}`
      );
    } catch (error) {
      console.error("get invite-link failed to DM the invite", error);
      await interaction.editReply(
        `Cannot DM you the invite (${errorMessage(error)}). Here it is, only you can see this: ${inviteUrl}`
      );
      return;
    }

    await interaction.editReply("Check your DM for the invite link");
  },
};
