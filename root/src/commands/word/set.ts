import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  MessageFlags,
} from "discord.js";

import { wordGame } from "../../ultils";
import { botLacksChannelAccess } from "../_shared/botChannelAccess";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "set";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Chọn phòng để bắt đầu chơi nối chữ")
      .addChannelOption((Option) =>
        Option.setName("channel")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.AnnouncementThread)
          .addChannelTypes(ChannelType.PublicThread)
          .addChannelTypes(ChannelType.PrivateThread)
          .setDescription("Kênh bạn muốn chọn")
          .setRequired(true)
      )
      .addIntegerOption((Option) =>
        Option.setName("max-words")
          .setDescription(
            "Số lần tối đa, không ít hơn 200 từ! Mặc định là 1500 từ."
          )
          .setMinValue(200)
          .setRequired(false)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const gid = interaction.guildId;
    const channel = interaction.options.getChannel(
      "channel",
      true
    ) as TextChannel;
    const maxWords = interaction.options.getInteger("max-words") ?? 1500;

    if (await botLacksChannelAccess(interaction, channel.id, "send")) {
      await interaction.reply({
        content: "Bot không có quyền gửi tin nhắn trong kênh này!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await wordGame.setWordGame(`${gid}`, channel.id, maxWords);
      await channel.send("Trò chơi bắt đầu! Vui lòng nhập 1 từ bất kỳ!");
    } catch (error) {
      console.error("word set failed", error);
      await interaction.reply({
        content: `Không thể bắt đầu trò chơi: ${errorMessage(error)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({ content: `Đã chọn phòng chơi: ${channel}` });
  },
};
