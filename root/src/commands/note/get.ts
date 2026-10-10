import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { noteUltils } from "../../ultils";
import { replyInChunks } from "../_shared/chunkedReply";

const commandName = "get";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Note eveything and find by role")
      .addRoleOption((Option) =>
        Option.setName("role").setDescription("role to note").setRequired(true)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const role = interaction.options.getRole("role");

    await replyInChunks(
      interaction,
      `Note for @${role.name}:\n${await noteUltils.getNote(role.id)}`
    );
  },
};
