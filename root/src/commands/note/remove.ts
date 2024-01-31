import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

const savePath = "./files/notes.json";
if (!existsSync(savePath)) {
	writeFileSync(savePath, JSON.stringify({}, null, 4));
}

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder.setName("remove")
			.setDescription("Remove saved-note by role")

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
	},

	async execute(interaction: ChatInputCommandInteraction) {
		const role = interaction.options.getRole("role");
		const topic = interaction.options.getString("topic");
		const notes = readFileSync(savePath, "utf-8");
		const notesJson = JSON.parse(notes);

		if (!notesJson[role.id][topic]) {
			interaction.reply({
				content: `No note found for @${role.name} with topic ${topic}`,
				ephemeral: false,
			});
			return;
		}

		delete notesJson[role.id][topic];

		writeFileSync(savePath, JSON.stringify(notesJson, null, 4));

		interaction.reply({
			content: `Note removed for @${role.name} with topic ${topic}`,
			ephemeral: false,
		});
	},
};
