const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("bulk-assign-role")
		.setDescription("Assign a role for many members by ID")
		.addStringOption(Option =>
			Option.setName("ids")
				.setDescription("seperate by comma, can be present as mention")
				.setRequired(true),
		)
		.addRoleOption(Option =>
			Option.setName("role")
				.setDescription("Role you want to assign")
				.setRequired(true),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		//const guild = interaction.client.guilds.cache.get('Guild ID');
		//const role = interaction.options.getRole("role");
		//const ids = interaction.options.getString("ids").replace(">", "").replace("<", "").replace("@").split(",");

		let members = await interaction.members.cache

		/*ids.forEach(id => {
			let member = guild.members.cache.get(id);
			member.addRole(role);
		});*/

		const message = {
			content: `${interaction}\n\n${members}`,
		};
		await interaction.reply(message);
	},
};