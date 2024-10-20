import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import Parser from "@gregoranders/csv";
import { happyBirthday } from "../../ultils";

const commandName = "append-list";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Add a list of users to the birthday list, csv format")
      .addAttachmentOption((Option) =>
        Option.setName("file")
          .setDescription("csv file with list of users")
          .setRequired(true)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const file = interaction.options.getAttachment("file");
    // check if file is csv
    if (!file.contentType.includes("csv")) {
      interaction.editReply("File must be a csv");
      return;
    }
    const guid = interaction.guildId;

    const fileUrl = file.url;
    const response = await fetch(fileUrl);
    const rawData = (await response.text()).replaceAll("\r", "");

    // parse csv
    const csvParser = new Parser();
    csvParser.parse(rawData);
    const parsedDataArr = csvParser.json;
    for (const member of parsedDataArr) {
      const name = member["Name"];
      const id = member["ID"];
      const discord = member["DiscordID"]
        .replaceAll(">", "")
        .replaceAll("<", "")
        .replaceAll("@", "");
      const day = Number(member["Day"]);
      const month = Number(member["Month"]);

      await happyBirthday.appendBirthday(guid, id, name, discord, day, month);
    }

    await interaction.editReply("File received");
  },
};
