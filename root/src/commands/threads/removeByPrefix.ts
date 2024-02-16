import {
	SlashCommandSubcommandBuilder,
	ChatInputCommandInteraction,
	ChannelType,
	TextChannel,
} from "discord.js";

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("remove-by-prefix")
			.setDescription("remove private threads")
			.addStringOption((Option) =>
				Option.setName("prefix")
					.setDescription("The prefix of the threads")
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
	},
	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		//const guild = interaction.client.guilds.cache.get('Guild ID');
		const targetChannel = (interaction.options.getChannel("destination") ??
			interaction.channel) as TextChannel;
		const prefix = interaction.options.getString("prefix").trimEnd().trimStart() ?? "unknown";
		let counter = 0;
		await interaction.deferReply({ ephemeral: true });

		//get all threads by prefix
		const threads = await targetChannel.threads.fetch();
		const filteredThreads = threads.threads.filter((thread) => thread.name.startsWith(prefix));

		//delete all threads
		for (const thread of filteredThreads.values()) {
			await thread.delete();
			counter++;
		}

		const message = {
			content: `Done ${counter} thread(s)!`,
		};

		await interaction.editReply(message);
	},
};
