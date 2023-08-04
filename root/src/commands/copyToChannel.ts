import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChannelType,
	TextChannel,
	ChatInputCommandInteraction,
	Message,
} from "discord.js";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export default {
	data: new SlashCommandBuilder()
		.setName("copy-to-channel")
		.setDescription("Copy a messsage to specific channel!")
		.addStringOption((Option) => Option.setName("message-link").setDescription("message link").setRequired(true))

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
		const targetChannel = (interaction.options.getChannel("destination") ?? interaction.channel) as TextChannel;

		targetChannel.sendTyping();
		const messageLink = interaction.options.getString("message-link");
		const pollChoiceCount = interaction.options.getInteger("poll-choice-count") ?? 0;

		const part = messageLink.split("/");
		const channelId = part[part.length - 2];
		const messageId = part[part.length - 1];

		const channel = (await interaction.client.channels.fetch(channelId)) as TextChannel;

		const messageFromID = (await channel.messages.fetch(messageId)) as Message;
		const attachments = messageFromID.attachments.values();
		const message = {
			content: messageFromID.content,
			files: [],
		};
		console.log(attachments);
		console.log(typeof attachments);
		for (const file of attachments) {
			message.files.push({
				attachment: file[1].attachment,
				name: file[1].name,
				description: file[1].description,
			});
		}
		await interaction.deferReply({ ephemeral: true });

		const resultMsg = await targetChannel.send(message);
		for (let i = 0; i < pollChoiceCount; i++) {
			await resultMsg.react(emojiPoll[i]);
		}

		interaction.editReply({
			content: "Done!",
		});
	},
};
