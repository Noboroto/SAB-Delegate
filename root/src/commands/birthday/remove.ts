import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { happyBirthday } from "../../ultils";

const commandName = "remove";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "Remove a user from the birthday list by student ID or Discord user"
      )
      .addStringOption((Option) =>
        Option.setName("student-id")
          .setDescription("The student ID to remove")
          .setRequired(false)
      )
      .addUserOption((Option) =>
        Option.setName("user")
          .setDescription("The Discord user to remove")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const guid = interaction.guildId;
    const studentId = interaction.options.getString("student-id")?.trim();
    const user = interaction.options.getUser("user");

    if (!studentId && !user) {
      await interaction.editReply(
        "Please provide a student ID or a Discord user"
      );
      return;
    }

    let result: String;
    if (studentId) {
      result = await happyBirthday.removeBirthday(guid, studentId);
    } else {
      result = await happyBirthday.removeBirthdayByDiscord(guid, user.id);
    }

    await interaction.editReply(result.toString());
  },
};
