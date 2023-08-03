const { Events } = require("discord.js");

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

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
			console.error(error);
		}
	}
};
