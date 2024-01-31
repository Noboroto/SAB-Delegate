import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

const savePath = "./files/notes.json";
if (!existsSync(savePath)) {
	writeFileSync(savePath, JSON.stringify({}, null, 4));
}

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
		.setName("get-by-role")
		.setDescription("Note eveything and find by role")
		.addRoleOption((Option) =>
			Option.setName("role")
				.setDescription("role to note")
				.setRequired(true)
		)},

	async execute(interaction: ChatInputCommandInteraction) {
		const role = interaction.options.getRole("role");

		const notes = readFileSync(savePath, "utf-8");
		const notesJson = JSON.parse(notes);

		notesJson[role.id] = notesJson[role.id] || {};

		interaction.reply({
			content: `Note for @${role.name}:\n${JSON.stringify(
				notesJson[role.id],
				null,
				4
			)}`,
			ephemeral: false,
			embeds: [],
		});
	},
};
