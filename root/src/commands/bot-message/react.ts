import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

const commandName = "react";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("react to a messsage!")

      .addStringOption((Option) =>
        Option.setName("emoji").setDescription("emoji").setRequired(true)
      )

      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )

      .addIntegerOption((Option) =>
        Option.setName("poll-choice-count")
          .setDescription("number of choices for poll")
          .setMinValue(0)
          .setMaxValue(10)
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    await interaction.deferReply({ ephemeral: true });

    const pollChoiceCount =
      interaction.options.getInteger("poll-choice-count") ?? 0;
    const reaction = interaction.options.getString("emoji")?.trim() ?? "";
    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );

    if (!messageFromID) {
      interaction.editReply({
        content: "Message not found!",
      });
      return;
    }

    await messageFromID.react(reaction);

    for (let i = 0; i < pollChoiceCount; i++) {
      await messageFromID.react(emojiPoll[i]);
    }

    interaction.editReply({
      content: "Done!",
    });
  },
};
