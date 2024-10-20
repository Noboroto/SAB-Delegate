import {
  ChannelType,
  TextChannel,
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption, jobScheduler } from "../../ultils";
import nodeScheduler from "node-schedule";

const commandName = "schedule-copy";

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
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    await interaction.deferReply({ ephemeral: true });

    const day = interaction.options.getInteger("day") ?? new Date().getDate();
    const month =
      interaction.options.getInteger("month") ?? new Date().getMonth() + 1;
    const year =
      interaction.options.getInteger("year") ?? new Date().getFullYear();
    const hour = interaction.options.getInteger("hour");
    const minute = interaction.options.getInteger("minute");
    const second = interaction.options.getInteger("second") ?? 0;

    const gui = interaction.guildId;

    const scheduleTime = new Date(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
      0
    );
    const currentTime = new Date();
    const currentTimeStr = currentTime.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const scheduleTimeStr = scheduleTime.toLocaleString("en-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (scheduleTime < currentTime) {
      interaction.editReply({
        content: `invalid time, user input time is ${scheduleTimeStr}`,
      });
      return;
    }

    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;

    const srcMsgLink = interaction.options.getString("message-link");

    const job = nodeScheduler.scheduleJob(scheduleTime, async () => {
      const messageFromID = await getMessageFromOption(
        interaction,
        "message-link"
      );

      if (!messageFromID) {
        return;
      }

      const attachments = messageFromID.attachments.values();
      const message = {
        content: messageFromID.content,
        files: [],
      };

      for (const file of attachments) {
        message.files.push(file);
      }
      await targetChannel.send(message);
    });

    // save job to scheduler
    const id = jobScheduler.saveJob(
      commandName,
      gui,
      interaction.user.username,
      `Copy from message to ${srcMsgLink}`,
      scheduleTimeStr,
      currentTimeStr,
      job
    );

    interaction.editReply({
      content: `Job has been scheduled with id ${id} at ${scheduleTimeStr}`,
    });
  },
};
