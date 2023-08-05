import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { readFileSync, writeFileSync } from "fs";

const savePath = "./files/notes.json";

export default {
	data: new SlashCommandBuilder()
		.setName("note-by-role")
		.setDescription("Note eveything and find by role")
		.addRoleOption((Option) => Option.setName("role").setDescription("role to note").setRequired(true))
		.addStringOption((Option) => Option.setName("topic").setDescription("topic").setRequired(true))
		.addStringOption((Option) => Option.setName("note").setDescription("will be replaced if topic existed").setRequired(false))

		.addBooleanOption((Option) => Option.setName("is-remove").setDescription("default is false").setRequired(false))

		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		const role = interaction.options.getRole("role");
		const topic = interaction.options.getString("topic");
		const note = interaction.options.getString("note");
		const isRemove = interaction.options.getBoolean("is-remove");

		const notes = readFileSync(savePath, "utf-8");
		const notesJson = JSON.parse(notes);

		if (!isRemove) {
			notesJson[role.id] = notesJson[role.id] || {};
			notesJson[role.id][topic] = note;
		} else {
			delete notesJson[role.id][topic];
		}

		writeFileSync(savePath, JSON.stringify(notesJson, null, 4));

		interaction.reply({
			content: `Note ${isRemove ? "removed" : "saved"} for @${role.name} with topic ${topic}`,
			ephemeral: false,
		});
    }
};