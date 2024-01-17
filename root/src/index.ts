// Require the necessary discord.js classes
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import events from "./events-bot/index";
import * as dotenv from "dotenv";

// Create a new client instance

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildMessageTyping,
		GatewayIntentBits.GuildPresences,
		GatewayIntentBits.GuildEmojisAndStickers,
		GatewayIntentBits.MessageContent,
	],
});

for (const event of events) {
	if (event.once) {
		try {
			client.once(event.name as string, (...args: []) =>
				event.execute([...args])
			);
		} catch (error) {
			const channel = client.guilds.cache
				.get("713025650176294945")
				.channels.cache.find(
					(channel) => channel.name === "bot-log"
				) as TextChannel;

			channel.send({
				content: `Error executing ${event.name}`,
			});
			channel.send({
				content: "```json\n" + JSON.stringify(error, null, 4) + "\n```",
			});

			console.error(`Error executing ${event.name}`);
			console.error(error);
		}
	} else {
		//log date and time of event execution
		console.log(`${new Date().toLocaleString()} - [Event] ${event.name}`);
		client.on(event.name as string, (...args: []) =>
			event.execute([...args])
		);
	}
}

if(!process.env.TOKEN) { 
	dotenv.config();
}

client.login(process.env.TOKEN);
