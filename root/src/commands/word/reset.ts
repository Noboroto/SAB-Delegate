import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { wordGame } from "../../ultils";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "reset";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder.setName(commandName).setDescription("Reset nối chữ");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const gid = interaction.guildId;

    try {
      const channelID = await wordGame.setWordGame(gid);
      if (!channelID) {
        await interaction.reply({
          content: "Chưa chọn phòng chơi!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channel = (await interaction.client.channels.fetch(
        channelID
      )) as TextChannel | null;
      if (!channel) {
        await interaction.reply({
          content: "Không tìm thấy phòng chơi, hãy chọn lại bằng /word set!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await channel.send("Trò chơi bắt đầu! Vui lòng nhập 1 từ bất kỳ!");
      await interaction.reply({ content: `Đã chọn phòng chơi: ${channel}` });
    } catch (error) {
      console.error("word reset failed", error);
      await interaction.reply({
        content: `Không thể reset trò chơi: ${errorMessage(error)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
