import {
	SlashCommandSubcommandBuilder,
	ChatInputCommandInteraction,
} from "discord.js";
import { noteUltils } from "../../ultils";


export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("get")
			.setDescription("Note eveything and find by role")
			.addRoleOption((Option) =>
				Option.setName("role")
					.setDescription("role to note")
					.setRequired(true)
			);
	},

	async execute(interaction: ChatInputCommandInteraction) {
		const role = interaction.options.getRole("role");

		interaction.reply({
			content: `Note for @${role.name}:\n${await noteUltils.getNote(role.id)}`,
			ephemeral: false,
			embeds: [],
		});
	},
};
