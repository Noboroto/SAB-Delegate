import {
	SlashCommandSubcommandBuilder,
	ChatInputCommandInteraction,
	Role,
	TextChannel,
	PermissionsBitField,
} from "discord.js";

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("id-by-role")
			.setDescription("Get all members who have a specific role")
			.addRoleOption((Option) =>
				Option.setName("role")
					.setDescription("Role you want to get the list of members")
					.setRequired(true)
			)
			.addBooleanOption((Option) =>
				Option.setName("in-this-channel")
					.setDescription("default is false")
					.setRequired(false)
			)
	},

	async execute(interaction: ChatInputCommandInteraction) {
		// restrict to only users with the ManageRoles permission
		if (!(interaction.member.permissions as PermissionsBitField).has(PermissionsBitField.Flags.ManageRoles)) {
			interaction.reply({
				content: "You don't have permission to use this command",
				ephemeral: true,
			});
			return;
		}


		const role = interaction.options.getRole("role") as Role;
		const inThisChannel = interaction.options.getBoolean("in-this-channel");
		let members = role.members;
		if (inThisChannel) {
			const channel = interaction.channel as TextChannel;
			const channelMembers = channel.members.map((member) => member.id);
			members = members.filter((member) => {
				return channelMembers.find((id) => id === member.id) !== undefined
			});
		}


		let replyMsg = `There are ${members.size} user(s) in ${role.name}: \n${members
			.map((member) => `${member.user.id}`)
			.join(",\n")
			}\n`;

		interaction.reply(replyMsg);
	},
};
