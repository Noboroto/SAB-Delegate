import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

export default {
  name: "by-a-reaction",
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(this.name)
      .setDescription("Mention who reacted to a message")
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("emoji").setDescription("emoji").setRequired(true)
      )

      .addStringOption((Option) =>
        Option.setName("reply-message")
          .setDescription("reply message link")
          .setRequired(false)
      )
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
          .setRequired(false)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    const response = interaction.options.getString("content");
    const reaction = interaction.options.getString("emoji")?.trim() ?? "";
    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );

    const needReplyMessage = await getMessageFromOption(
      interaction,
      "reply-message"
    );

    if (!messageFromID) {
      await interaction.editReply({
        content: "Please provide a valid message link",
      });
      return;
    }

    const reactMemberListID: string[] = [];
    const reactionList = await messageFromID.reactions.cache;

    for (const reactionFromMessage of reactionList.values()) {
      if (reactionFromMessage.emoji.toString() !== reaction) continue;
      await reactionFromMessage.users.fetch().then((users) => {
        users.forEach((user) => {
          if (user.bot) return;
          reactMemberListID.push(user.id);
        });
      });
    }

    let replyMsg = `Reply to ${interaction.user}, there are ${reactMemberListID.length} user(s) who reacted with ${reaction}: \n`;
    for (const userID of reactMemberListID) {
      replyMsg += `<@${userID}>`;
      if (userID === interaction.user.id) replyMsg += " (author)";
      replyMsg += ",\n";
    }

    replyMsg += response ? `\n${response}` : "";

    if (!reactMemberListID.length) {
      interaction.reply({
        content: "No one reacted with that emoji",
        ephemeral: true,
      });
      return;
    }

    if (needReplyMessage) {
      needReplyMessage.reply(replyMsg);
      return;
    } else interaction.reply(replyMsg);
  },
};
