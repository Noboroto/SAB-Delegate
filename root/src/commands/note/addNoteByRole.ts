import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { readFileSync, writeFileSync, existsSync } from "fs";

const savePath = "./files/notes.json";

if (!existsSync(savePath)) {
	writeFileSync(savePath, JSON.stringify({}, null, 4));
}

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
		.setName("add-by-role")
		.setDescription("Note eveything and save by role")

		.addRoleOption((Option) =>
			Option.setName("role")
				.setDescription("role to note")
				.setRequired(true)
		)
		.addStringOption((Option) =>
			Option.setName("topic")
				.setDescription("Warning: case-sensitive!")
				.setRequired(true)
		)
		.addStringOption((Option) =>
			Option.setName("note")
				.setDescription("will be replaced if topic existed")
				.setRequired(false)
		)},

	async execute(interaction: ChatInputCommandInteraction) {
		const role = interaction.options.getRole("role");
		const topic = interaction.options.getString("topic");
		const note = interaction.options.getString("note");

		const notes = readFileSync(savePath, "utf-8");
		const notesJson = JSON.parse(notes);

		notesJson[role.id] = notesJson[role.id] || {};
		notesJson[role.id][topic] = note;

		writeFileSync(savePath, JSON.stringify(notesJson, null, 4));

		interaction.reply({
			content: `Note saved for @${role.name} with topic ${topic}`,
			ephemeral: false,
		});
	},
};
