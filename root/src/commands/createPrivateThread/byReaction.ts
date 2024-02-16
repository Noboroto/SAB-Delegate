import {
	SlashCommandSubcommandBuilder,
	ChatInputCommandInteraction,
	ChannelType,
	TextChannel,
} from "discord.js";

import { getMessageFromOption } from "../../ultils";

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("by-reaction")
			.setDescription("Create a private thread for each member in the list")
			.addStringOption((Option) =>
				Option.setName("prefix")
					.setDescription("The prefix of the threads")
					.setRequired(true)
			)
			.addStringOption((Option) =>
				Option.setName("message-link")
					.setDescription("message link")
					.setRequired(true)
			)
			.addStringOption((Option) =>
				Option.setName("emoji").setDescription("emoji").setRequired(true)
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
	},
	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		//const guild = interaction.client.guilds.cache.get('Guild ID');
		const targetChannel = (interaction.options.getChannel("destination") ??
			interaction.channel) as TextChannel;
		const prefix = interaction.options.getString("prefix") ?? "unknown";

		await interaction.deferReply({ ephemeral: true });
		const reaction = interaction.options.getString("emoji")?.trim() ?? "";
		const messageFromID = await getMessageFromOption(
			interaction,
			"message-link"
		);

		if (!messageFromID) {
			await interaction.editReply({
				content: "Please provide a valid message link",
			});
			return;
		}

		const unique_ids: string[] = [];
		const reactionList = await messageFromID.reactions.cache;

		for (const reactionFromMessage of reactionList.values()) {
			if (reactionFromMessage.emoji.toString() !== reaction) continue;
			await reactionFromMessage.users.fetch().then((users) => {
				users.forEach((user) => {
					if (user.bot) return;
					unique_ids.push(user.id);
				});
			});
		}

		const guild = await interaction.guild.fetch();
		const members = await guild.members.cache;

		let counter = 0;

		await unique_ids.forEach(async (id) => {
			const member = await members.get(id);
			if (!member) return;
			counter++;
			const latestThread = await targetChannel.threads.create({
				type: ChannelType.PrivateThread,
				name: `${prefix}-${member.user.username}`,
				autoArchiveDuration: 10080,
				reason: `Create thread for ${prefix}`,
			});
			latestThread.send({
				content: `Hello ${member}, ${interaction.user}!`,
			});
		});

		const message = {
			content: `Done ${counter} thread(s)!`,
		};

		await interaction.editReply(message);
	},
};
