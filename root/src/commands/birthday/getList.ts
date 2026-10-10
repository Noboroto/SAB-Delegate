import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";

import { happyBirthday } from "../../ultils";
import { sendInChunks } from "../_shared/chunkedReply";

const commandName = "get-list";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Get a list of users in the birthday list")
      .addIntegerOption((Option) =>
        Option.setName("month")
          .setDescription("birthday in a specific month")
          .setMinValue(1)
          .setMaxValue(12)
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    const month = interaction.options.getInteger("month") ?? 0;
    await interaction.reply("Getting list of users in the birthday list");
    const guid = interaction.guildId;

    for (let m = 1; m <= 12; m++) {
      if (month !== 0 && month !== m) continue;
      const monthList = await happyBirthday.getMonthList(guid, m);
      if (monthList === "No birthdays found") {
        continue;
      }
      await sendInChunks(`## Month ${m}:\n${monthList}`, (content) =>
        interaction.followUp(content)
      );
    }

    await interaction.followUp("Done!");
  },
};
