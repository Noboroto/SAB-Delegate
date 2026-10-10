import { Client, GatewayIntentBits } from "discord.js";
import events from "./events-bot/index";
import { reportError } from "./ultils";
import { dbReady } from "./ultils/db";
import * as dotenv from "dotenv";

if (!process.env.TOKENS) {
  dotenv.config({ quiet: true });
}

// One process hosts every bot; a stray rejection must not take them all down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});

const tokens = (process.env.TOKENS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

if (tokens.length === 0) {
  console.error("TOKENS is empty: set at least one bot token");
  process.exit(1);
}

const clients = tokens.map(
  () =>
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildExpressions,
      ],
    })
);

for (const event of events) {
  if (!event.once) {
    console.info(`${new Date().toLocaleString()} - [Event] ${event.name}`);
  }
  for (const client of clients) {
    const handler = (...args: []) =>
      event
        .execute([...args])
        .catch((error: unknown) =>
          reportError(client, `Error executing ${event.name}`, error)
        );
    if (event.once) client.once(event.name as string, handler);
    else client.on(event.name as string, handler);
  }
}

const main = async () => {
  await dbReady;
  const results = await Promise.allSettled(
    clients.map((client, index) => client.login(tokens[index]))
  );
  const failed = results.flatMap((result, index) =>
    result.status === "rejected" ? [{ index, reason: result.reason }] : []
  );
  if (failed.length > 0) {
    for (const { index, reason } of failed) {
      console.error(`Bot #${index + 1} failed to log in`, reason);
    }
    // Exit so the container restart policy retries; staying up would leave
    // that bot offline behind a healthy-looking container.
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Startup failed", error);
  process.exit(1);
});
