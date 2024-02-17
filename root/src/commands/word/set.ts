import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";

import { wordGame } from "../../ultils";

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
    const channel = interaction.options.getChannel("channel") as TextChannel;
    const maxWords = interaction.options.getInteger("max-words") ?? 1500;

    if (
      !interaction.guild.members.me.permissions.has([
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ViewChannel,
      ])
    ) {
      interaction.reply({
        content: "Bot không có quyền gửi tin nhắn trong kênh này!",
        ephemeral: true,
      });
      return;
    }

    wordGame.setWordGame(`${gid}`, channel.id, maxWords);
    channel.send("Trò chơi bắt đầu! Vui lòng nhập 1 từ bất kỳ!");
    interaction.reply({ content: `Đã chọn phòng chơi: ${channel}` });
  },
};
