import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import Parser from "@gregoranders/csv";
import { happyBirthday } from "../../ultils";
import { birthdayDb } from "../../ultils/db";
import { replyInChunks } from "../_shared/chunkedReply";

const commandName = "append-list";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_REPORTED_PROBLEMS = 20;

// The same student ID must not be stored twice for one guild.
const getExistingIds = async (guid: string): Promise<Set<string>> => {
  const ids = new Set<string>();
  const data: Record<string, Record<string, { id: string }[]>> | null =
    await birthdayDb.get(`${guid}.data`);
  for (const month of Object.values(data ?? {})) {
    for (const people of Object.values(month ?? {})) {
      if (!Array.isArray(people)) continue;
      for (const person of people) ids.add(String(person.id));
    }
  }
  return ids;
};

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const file = interaction.options.getAttachment("file");
    // check if file is csv
    if (!file.contentType?.includes("csv")) {
      await interaction.editReply("File must be a csv");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      await interaction.editReply("File is too large (max 1 MB)");
      return;
    }
    const guid = interaction.guildId;

    const response = await fetch(file.url);
    if (!response.ok) {
      await interaction.editReply(
        `Cannot download the file (HTTP ${response.status})`
      );
      return;
    }
    const rawData = (await response.text()).replaceAll("\r", "");

    // parse csv
    let parsedDataArr: readonly Record<string, string>[];
    try {
      const csvParser = new Parser();
      csvParser.parse(rawData);
      parsedDataArr = csvParser.json;
    } catch (error) {
      console.error("Failed to parse birthday csv", error);
      await interaction.editReply("Cannot read the csv file");
      return;
    }

    const knownIds = await getExistingIds(guid);
    let added = 0;
    const problems: string[] = [];

    for (const [index, member] of parsedDataArr.entries()) {
      // +2: one for the header row, one because humans count from 1.
      const row = index + 2;
      const name = member["Name"]?.trim();
      const id = member["ID"]?.trim();
      const discord = member["DiscordID"]
        ?.replaceAll(">", "")
        .replaceAll("<", "")
        .replaceAll("@", "")
        .trim();
      const day = Number(member["Day"]);
      const month = Number(member["Month"]);

      if (!name || !id || !discord) {
        problems.push(`Row ${row}: missing Name, ID or DiscordID`);
        continue;
      }
      if (
        !Number.isInteger(day) ||
        !Number.isInteger(month) ||
        day < 1 ||
        day > 31 ||
        month < 1 ||
        month > 12
      ) {
        problems.push(`Row ${row}: invalid Day/Month`);
        continue;
      }
      if (knownIds.has(id)) {
        problems.push(`Row ${row}: ID ${id} already exists`);
        continue;
      }

      try {
        await happyBirthday.appendBirthday(guid, id, name, discord, day, month);
        knownIds.add(id);
        added++;
      } catch (error) {
        console.error(`Failed to save birthday row ${row}`, error);
        problems.push(`Row ${row}: could not be saved`);
      }
    }

    const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
    const more = problems.length - shown.length;
    await replyInChunks(
      interaction,
      `Added ${added} of ${parsedDataArr.length} row(s).` +
        (problems.length
          ? `\nSkipped ${problems.length}:\n${shown.join("\n")}` +
            (more > 0 ? `\n...and ${more} more` : "")
          : ""),
      { ephemeral: true }
    );
  },
};
