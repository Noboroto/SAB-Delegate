import {
  ChannelType,
  TextChannel,
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption, jobScheduler } from "../../ultils";
import { buildMessageCopy } from "../_shared/copyMessage";
import { readScheduleTime } from "../_shared/scheduleTime";
import nodeScheduler from "node-schedule";

const commandName = "schedule-copy";
const MAX_DESCRIPTION_LENGTH = 200;

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "Schedule to copy a messsage (cannot edit) - UTC+7 timezone"
      )
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addIntegerOption((Option) =>
        Option.setName("hour")
          .setDescription("The hour you want to schedule (0 - 23)")
          .setMinValue(0)
          .setMaxValue(23)
          .setRequired(true)
      )
      .addIntegerOption((Option) =>
        Option.setName("minute")
          .setDescription("The minute you want to schedule (0 - 59)")
          .setMinValue(0)
          .setMaxValue(59)
          .setRequired(true)
      )
      .addIntegerOption((Option) =>
        Option.setName("second")
          .setDescription(
            "The second you want to schedule (0 - 59). Default is 0"
          )
          .setMinValue(0)
          .setMaxValue(59)
          .setRequired(false)
      )
      .addIntegerOption((Option) =>
        Option.setName("day")
          .setDescription("Default is today, the day you want to schedule")
          .setMinValue(1)
          .setMaxValue(31)
          .setRequired(false)
      )
      .addIntegerOption((Option) =>
        Option.setName("month")
          .setDescription("Default is today, he month you want to schedule")
          .setMinValue(1)
          .setMaxValue(12)
          .setRequired(false)
      )
      .addIntegerOption((Option) =>
        Option.setName("year")
          .setDescription("Default is today, the year you want to schedule")
          .setMinValue(2024)
          .setMaxValue(2030)
          .setRequired(false)
      )

      .addChannelOption((Option) =>
        Option.setName("destination")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.AnnouncementThread)
          .addChannelTypes(ChannelType.PublicThread)
          .addChannelTypes(ChannelType.PrivateThread)
          .setDescription("default is where you run this command")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const gui = interaction.guildId;
    const {
      date: scheduleTime,
      dateStr: scheduleTimeStr,
      nowStr: currentTimeStr,
    } = readScheduleTime(interaction);

    if (!scheduleTime) {
      await interaction.editReply({
        content: `invalid date, user input is ${scheduleTimeStr}`,
      });
      return;
    }
    if (scheduleTime <= new Date()) {
      await interaction.editReply({
        content: `invalid time, user input time is ${scheduleTimeStr}`,
      });
      return;
    }

    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;

    const srcMsgLink = interaction.options.getString("message-link");

    const job = nodeScheduler.scheduleJob(scheduleTime, async () => {
      try {
        const messageFromID = await getMessageFromOption(
          interaction,
          "message-link"
        );
        if (!messageFromID) return;

        const message = buildMessageCopy(messageFromID);
        if (!message) return;

        await targetChannel.send(message);
      } catch (error) {
        console.error("Scheduled bot-message copy failed", error);
      }
    });

    if (!job) {
      await interaction.editReply({
        content: `invalid time, user input time is ${scheduleTimeStr}`,
      });
      return;
    }

    // save job to scheduler
    const id = jobScheduler.saveJob(
      commandName,
      gui,
      interaction.user.username,
      `Copy from ${srcMsgLink} to ${targetChannel}`.slice(
        0,
        MAX_DESCRIPTION_LENGTH
      ),
      scheduleTimeStr,
      currentTimeStr,
      job
    );

    await interaction.editReply({
      content: `Job has been scheduled with id ${id} at ${scheduleTimeStr}`,
    });
  },
};
