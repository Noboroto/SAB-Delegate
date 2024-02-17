import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import { wordGame } from "../../ultils";

const commandName = "reset";

export default {
	name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder.setName(commandName).setDescription("Reset nối chữ");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const gid = interaction.guildId;

    const channelID = await wordGame.setWordGame(gid);
    if (!channelID) {
      interaction.reply({
        content: "Chưa chọn phòng chơi!",
        ephemeral: true,
      });
      return;
    }

    const channel = (await interaction.client.channels.fetch(
      channelID
    )) as TextChannel;

    channel.send("Trò chơi bắt đầu! Vui lòng nhập 1 từ bất kỳ!");
    interaction.reply({ content: `Đã chọn phòng chơi: ${channel}` });
  },
};
