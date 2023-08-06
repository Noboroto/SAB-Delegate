import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChannelType,
	TextChannel,
	ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../ultils";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

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
				.setDescription("destination channel")
				.setRequired(false)
		)
		.addIntegerOption((Option) =>
			Option.setName("poll-choice-count")
				.setDescription("number of choices for poll")
				.setMinValue(0)
				.setMaxValue(10)
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
			"nmessage-link"
		);
		const pollChoiceCount =
			interaction.options.getInteger("poll-choice-count") ?? 0;

		const attachments = await messageFromID.attachments.values();
		const message = {
			content: messageFromID.content,
			files: [],
		};

		for (const file of attachments) {
			message.files.push(file);
		}

		const resultMsg = await targetChannel.send(message);
		for (let i = 0; i < pollChoiceCount; i++) {
			await resultMsg.react(emojiPoll[i]);
		}

		interaction.editReply({
			content: "Done!",
		});
	},
};
