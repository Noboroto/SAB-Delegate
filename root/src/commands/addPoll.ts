import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../ultils";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export default {
  data: new SlashCommandBuilder()
    .setName("add-poll")
    .setContexts(InteractionContextType.Guild)
    .setDescription("add extra poll choices to a messsage or new one!")

    .addIntegerOption((Option) =>
      Option.setName("poll-choice-count")
        .setDescription("number of choices for poll")
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(true)
    )

    .addStringOption((Option) =>
      Option.setName("message-link")
        .setDescription("existed message link, default will create new message")
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const pollChoiceCount =
      interaction.options.getInteger("poll-choice-count") ?? 0;
    const hasLink = Boolean(interaction.options.getString("message-link"));
    const existing = await getMessageFromOption(interaction, "message-link");

    if (hasLink && !existing) {
      await interaction.editReply({
        content: "Message not found! Check the link.",
      });
      return;
    }

    const poll = existing ?? (await interaction.channel?.send("New Poll!"));
    if (!poll) {
      await interaction.editReply({
        content: "Cannot send a message to this channel!",
      });
      return;
    }

    for (let i = 0; i < pollChoiceCount; i++) {
      await poll.react(emojiPoll[i]);
    }

    await interaction.editReply({
      content: "Done!",
    });
  },
};
