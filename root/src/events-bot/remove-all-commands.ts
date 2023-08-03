import { Client, Events } from "discord.js";

export default {
	name: Events.ClientReady,
	once: true,
	execute(client: Client) {
		client.application.commands.set([]).then(() => console.log("Successfully deleted application command"));
	}
};
