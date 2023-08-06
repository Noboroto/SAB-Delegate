import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { readFileSync, writeFileSync } from "fs";

const savePath = "./files/notes.json";
if (!readFileSync(savePath, "utf-8")) {
	writeFileSync(savePath, "{}");
}

export default {
	data: new SlashCommandBuilder()
		.setName("get-note-by-role")
		.setDescription("Note eveything and find by role")
		.addRoleOption((Option) =>
			Option.setName("role")
				.setDescription("role to note")
				.setRequired(true)
		)
		.setDMPermission(false),

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
