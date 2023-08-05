import { Events } from "discord.js";
import commands from "../commands";

export default {
	name: Events.InteractionCreate,
	once: false,
	async execute(args: any) {
		const interaction = args[0];

		if (!interaction.isChatInputCommand()) return;

		const command = commands.find((command) => command.data.name === interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			const channel = interaction.client.guilds.cache
				.get("713025650176294945")
				.channels.cache.find((channel) => channel.name === "bot-log");

			channel.send({ content: `Error executing ${interaction.commandName}` });
			channel.send({ content: "```json\n" + JSON.stringify(error, null, 4) + "\n```" });

			console.error(`Error executing ${interaction.commandName}`);

			const errorMessage = {
				content: "There was an error while executing this command!",
				ephemeral: true,
			};

			interaction.followUp(errorMessage);

			console.error(error);
		}
	},
};
