const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("bulk-modify-role-member-test")
		.setDescription("Assign or remove a role for many members by ID")
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
		.addBooleanOption(Option =>
			Option.setName("is-remove")
				.setDescription("default is false")
				.setRequired(false),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		//const guild = interaction.client.guilds.cache.get('Guild ID');
		const role = interaction.options.getRole("role");
		const isRemove = interaction.options.getBoolean("is-remove");
		const ids = interaction.options.getString("ids").replaceAll(">", "").replaceAll("<", "").replaceAll("@", "").split(/[\s,]+/);
		let guild = await interaction.guild.fetch()
		let members = await guild.members.cache

		ids.forEach(async id => {
			let member = await members.get(id);
			if (!member) return;
			await member.roles.add(role);
			//else await member.roles.isRemove(role);
		});

		const message = {
			content: `Complete add role`,
		};
		await interaction.reply(message);
	},
};