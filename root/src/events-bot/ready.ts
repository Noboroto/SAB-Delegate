import { Client, Events } from "discord.js";
import commands from "../commands";

export default {
	name: Events.ClientReady,
	once: true,
	async execute(args: Client[]) {
		const client = args[0] as Client;
		console.log(`Ready! Logged in as ${client.user?.tag}`);
		return;
		await client.application.commands
			.set([])
			.then(() =>
				console.log("Successfully deleted application command")
			);

		console.log();
		for (const command of commands) {
			client.application.commands
				.create(command.data)
				.then(() =>
					console.log(
						`Successfully registered application command "${command.data.name}"`
					)
				)
				.catch((error) =>
					console.error(
						`Error registering application command "${command.data.name}"\n${error}`
					)
				);
		}
	},
};
