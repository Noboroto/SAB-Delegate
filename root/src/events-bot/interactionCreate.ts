import { Events, Interaction, TextChannel } from "discord.js";
import commands from "../commands";

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(args: Interaction[]) {
    const interaction = args[0];

    if (!interaction.isChatInputCommand()) return;

    const command = commands.find(
      (command) => command.data.name === interaction.commandName
    );

    if (!command) {
      console.error(
        `[${new Date().toLocaleString()}-[${
          interaction.client.user?.username
        }] No command matching ${interaction.commandName} was found.`
      );
      return;
    }

    try {
      console.info(
        `[${new Date().toLocaleString()}]-[${
          interaction.client.user?.username
        }][Command] ${interaction.user.username} - ${interaction.commandName}`
      );
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing ${interaction.commandName}`);
      console.error(error);

      const guild = interaction.client.guilds.cache.get("713025650176294945");
      if (guild) {
        const channel = guild.channels.cache.find(
          (channel) => channel.name === "bot-log"
        ) as TextChannel;

        if (channel) {
          const errorStr = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack}`
            : JSON.stringify(error, null, 4);
          channel.send({
            content: `Error executing ${interaction.commandName}`,
          }).catch(() => {});
          channel.send({
            content: "```\n" + errorStr + "\n```",
          }).catch(() => {});
        }
      }

      const errorMessage = {
        content: "There was an error while executing this command!",
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        interaction.followUp(errorMessage).catch(() => {});
      } else {
        interaction.reply(errorMessage).catch(() => {});
      }
    }
  },
};
