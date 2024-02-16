import { Client, Events } from "discord.js";
import commands from "../commands";

export default {
  name: Events.ClientReady,
  once: true,
  async execute(args: Client[]) {
    const client = args[0] as Client;
    console.info(`Ready! Logged in as ${client.user?.username}`);

    return;
    await client.application.commands
      .set([])
      .then(() =>
        console.info(
          `${client.user?.username} Successfully deleted application command`
        )
      );

    console.info();
    for (const command of commands) {
      await client.application.commands
        .create(command.data)
        .then(() =>
          console.info(
            `${client.user?.username} Successfully registered application command "${command.data.name}"`
          )
        )
        .catch((error) =>
          console.error(
            `${client.user?.username} Error registering application command "${command.data.name}"\n${error}`
          )
        );
    }

    console.info(
      `${client.user?.username} Successfully registered all application commands`
    );
  },
};
