// Require the necessary discord.js classes
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import events from "./events-bot/index";
import * as dotenv from "dotenv";

// Create a new client instance

if (!process.env.TOKENS) {
  dotenv.config();
}

const clients: Client[] = [];
const rawTokens: string[] = process.env.TOKENS.split(",");
const tokens = rawTokens.map((token) => {
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
  clients.push(client);
  return token.trimEnd().trimStart();
});

for (const event of events) {
  if (event.once) {
    try {
      clients.forEach((client) => {
        client.once(event.name as string, (...args: []) =>
          event.execute([...args])
        );
      });
    } catch (error) {
      clients.forEach((client) => {
        const channel = client.guilds.cache
          .get("713025650176294945")
          .channels.cache.find(
            (channel) => channel.name === "bot-log"
          ) as TextChannel;

        if (!channel) return;

        channel.send({
          content: `Error executing ${event.name}`,
        });
        channel.send({
          content: "```json\n" + JSON.stringify(error, null, 4) + "\n```",
        });

        console.error(`Error executing ${event.name}`);
        console.error(error);
      });
    }
  } else {
    //log date and time of event execution
    console.info(`${new Date().toLocaleString()} - [Event] ${event.name}`);
    clients.forEach((client) => {
      client.on(event.name as string, (...args: []) =>
        event.execute([...args])
      );
    });
  }
}

clients.forEach((client, index) => {
  client.login(tokens[index]);
});
