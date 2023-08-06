import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { readFileSync, writeFileSync } from "fs";

const savePath = "./files/notes.json";

export default {
	data: new SlashCommandBuilder()
		.setName("remove-note-by-role")
		.setDescription("Remove saved-note by role")

		.addRoleOption((Option) =>
			Option.setName("role")
				.setDescription("role to note")
				.setRequired(true)
		)
		.addStringOption((Option) =>
			Option.setName("topic").setDescription("topic").setRequired(true)
		)

		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		const role = interaction.options.getRole("role");
		const topic = interaction.options.getString("topic");
		const notes = readFileSync(savePath, "utf-8");
		const notesJson = JSON.parse(notes);

		delete notesJson[role.id][topic];

		writeFileSync(savePath, JSON.stringify(notesJson, null, 4));

		interaction.reply({
			content: `Note removed for @${role.name} with topic ${topic}`,
			ephemeral: false,
		});
	},
};
