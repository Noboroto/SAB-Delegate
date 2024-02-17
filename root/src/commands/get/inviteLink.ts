import {
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  SlashCommandSubcommandBuilder,
} from "discord.js";

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
      )
  },
  async execute(interaction: ChatInputCommandInteraction) {

    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;
		const invite = await targetChannel.createInvite(
			{
				maxAge: 0,
				maxUses: 0,
				unique: true,
				reason: `Requested by ${interaction.user.username}`
			}
		);
		interaction.user.send(`Invite link for ${targetChannel.name} is ${invite.url}`);

		interaction.reply({
			content : "Check your DM for the invite link",
			ephemeral: true
		});
  },
};
