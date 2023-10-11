import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChatInputCommandInteraction,
} from "discord.js";

export default {
	data: new SlashCommandBuilder()
		.setName("bulk-remove-all-role")
		.setDescription("Remove all role for many members by ID")
		.addStringOption((Option) =>
			Option.setName("ids")
				.setDescription("seperate by comma, can be present as mention")
				.setRequired(true)
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		//const guild = interaction.client.guilds.cache.get('Guild ID');

		await interaction.deferReply({ ephemeral: true });
		const ids = interaction.options
			.getString("ids")
			.replaceAll(">", "")
			.replaceAll("<", "")
			.replaceAll("@", "")
			.split(/[\s,]+/);
		const unique_ids = [...new Set(ids)];

		const guild = await interaction.guild.fetch();
		const members = await guild.members.cache;

		let counter = 0;

		await unique_ids.forEach(async (id) => {
			const member = await members.get(id);
			if (!member) return;
			counter++;
			console.log(counter);
			await member.roles.remove(member.roles.cache);
		})

		console.log(counter + " members done");
		const message = {
			content: `Done ${counter} member(s)!`,
		};

		await interaction.editReply(message);
	},
};
