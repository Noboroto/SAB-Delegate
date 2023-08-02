const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("bulk-assign-role")
		.setDescription("Assign a role for many members by ID")
		.addStringOption(Option =>
			Option.setName("IDs")
				.setDescription("seperate by comma, can be present as mention")
				.setRequired(true),
		)
		.addRoleOption(Option =>
			Option.setName("Role")
				.setDescription("Role you want to assign")
				.setRequired(true),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const guild = interaction.guild;
		const role = interaction.options.getRole("Role");
		const ids = interaction.options.getString("IDs").replace(">", "").replace("<", "").replace("@").split(",");

		ids.forEach(id => {
			const member = guild.members.cache.get(id);
			member.roles.add(role);
		});

		const message = {
			content: `Complete add ${ids.length}`,
		};
		await interaction.reply(message);
	},
};