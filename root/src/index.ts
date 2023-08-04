// Require the necessary discord.js classes
import { Client, GatewayIntentBits } from "discord.js";
import events from "./events-bot/index";
import config from "./config";

// Create a new client instance
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

for (const event of events) {
	if (event.once) {
		client.once(event.name as string, (...args: []) => event.execute([...args]));
	} else {
		client.on(event.name as string, (...args: []) => event.execute([...args]));
	}
}

client.login(config.token);
