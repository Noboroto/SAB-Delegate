import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChannelType,
	TextChannel,
	ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../ultils";

export default {
	data: new SlashCommandBuilder()
		.setName("copy-to-channel")
		.setDescription("Copy a messsage to specific channel!")
		.addStringOption((Option) =>
			Option.setName("message-link")
				.setDescription("message link")
				.setRequired(true)
		)

		.addChannelOption((Option) =>
			Option.setName("destination")
				.addChannelTypes(ChannelType.GuildText)
				.addChannelTypes(ChannelType.GuildAnnouncement)
				.addChannelTypes(ChannelType.AnnouncementThread)
				.addChannelTypes(ChannelType.PublicThread)
				.addChannelTypes(ChannelType.PrivateThread)
				.setDescription("default is where you run this command")
				.setRequired(false)
		)

		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const targetChannel = (interaction.options.getChannel("destination") ??
			interaction.channel) as TextChannel;

		targetChannel.sendTyping();
		await interaction.deferReply({ ephemeral: true });

		const messageFromID = await getMessageFromOption(
			interaction,
			"message-link"
		);

		if (!messageFromID) {
			interaction.editReply({
				content: "Message not found!",
			});
			return;
		}

		const attachments = messageFromID.attachments.values();
		const message = {
			content: messageFromID.content,
			files: [],
		};

		for (const file of attachments) {
			message.files.push(file);
		}

		await targetChannel.send(message);

		interaction.editReply({
			content: "Done!",
		});
	},
};
