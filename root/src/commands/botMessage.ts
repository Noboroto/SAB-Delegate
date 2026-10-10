import copyPaste from "./bot-message/copy-paste";
import scheduleCopy from "./bot-message/schedule-copy";
import editCopy from "./bot-message/edit-copy";
import editSend from "./bot-message/edit-send";
import react from "./bot-message/react";
import send from "./bot-message/send";
import scheduleSend from "./bot-message/schedule-send";
import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("bot-message")
    .setDescription("Using bot to send message to channel")
    .addSubcommand(copyPaste.addCommand)
    .addSubcommand(scheduleCopy.addCommand)
    .addSubcommand(editCopy.addCommand)
    .addSubcommand(editSend.addCommand)
    .addSubcommand(react.addCommand)
    .addSubcommand(send.addCommand)
    .addSubcommand(scheduleSend.addCommand)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case copyPaste.name:
        await copyPaste.execute(interaction);
        break;
      case scheduleCopy.name:
        await scheduleCopy.execute(interaction);
        break;
      case editCopy.name:
        await editCopy.execute(interaction);
        break;
      case editSend.name:
        await editSend.execute(interaction);
        break;
      case react.name:
        await react.execute(interaction);
        break;
      case send.name:
        await send.execute(interaction);
        break;
      case scheduleSend.name:
        await scheduleSend.execute(interaction);
        break;
      default:
        await interaction.reply({
          content: `Invalid subcommand ${commands}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};
