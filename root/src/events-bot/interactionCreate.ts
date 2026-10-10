import { Events, Interaction, MessageFlags } from "discord.js";
import commands from "../commands";
import { reportError } from "../ultils";

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
      await reportError(
        interaction.client,
        `Error executing ${interaction.commandName}`,
        error
      );

      const errorMessage = {
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      } as const;

      const respond =
        interaction.replied || interaction.deferred
          ? interaction.followUp(errorMessage)
          : interaction.reply(errorMessage);
      await respond.catch(() => {});
    }
  },
};
