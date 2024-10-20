import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getMessageFromOption } from "../ultils";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export default {
  data: new SlashCommandBuilder()
    .setName("add-poll")
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
    )

    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    await interaction.deferReply({ ephemeral: true });

    const pollChoiceCount =
      interaction.options.getInteger("poll-choice-count") ?? 0;
    const messageFromID =
      (await getMessageFromOption(interaction, "message-link")) ??
      (await interaction.channel?.send("New Poll!"));

    for (let i = 0; i < pollChoiceCount; i++) {
      await messageFromID.react(emojiPoll[i]);
    }

    interaction.editReply({
      content: "Done!",
    });
  },
};
