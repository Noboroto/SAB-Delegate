import {
	ChannelType,
	TextChannel,
	ChatInputCommandInteraction,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption, jobScheduler } from "../../ultils";
import nodeScheduler from 'node-schedule';


export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("schedule-copy")
			.setDescription("Schedule to copy a messsage - UTC+7 timezone")
			.addStringOption((Option) =>
				Option.setName("message-link")
					.setDescription("message link")
					.setRequired(true)
			)
			.addIntegerOption((Option) => 
				Option.setName("day")
					.setDescription("The day you want to schedule")
					.setMinValue(1)
					.setMaxValue(31)
					.setRequired(true)
			)
			.addIntegerOption((Option) =>
				Option.setName("month")
					.setDescription("The month you want to schedule")
					.setMinValue(1)
					.setMaxValue(12)
					.setRequired(true)
			)
			.addIntegerOption((Option) =>
				Option.setName("year")
					.setDescription("The year you want to schedule")
					.setMinValue(2024)
					.setMaxValue(2030)
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
			.addChannelOption((Option) =>
				Option.setName("destination")
					.addChannelTypes(ChannelType.GuildText)
					.addChannelTypes(ChannelType.GuildAnnouncement)
					.addChannelTypes(ChannelType.AnnouncementThread)
					.addChannelTypes(ChannelType.PublicThread)
					.addChannelTypes(ChannelType.PrivateThread)
					.setDescription("default is where you run this command")
					.setRequired(false)
			)
	},
	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const day = interaction.options.getInteger("day");
		const month = interaction.options.getInteger("month");
		const year = interaction.options.getInteger("year");
		const hour = interaction.options.getInteger("hour");
		const minute = interaction.options.getInteger("minute");

		const scheduleTime = new Date(year, month - 1, day, hour, minute, 0, 0);
		const currentTime = new Date();
		if (scheduleTime < currentTime) {
			interaction.reply({
				content: "Invalid date time",
				ephemeral: true,
			});
			return;
		}

		const targetChannel = (interaction.options.getChannel("destination") ??
			interaction.channel) as TextChannel;

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

		const attachments = messageFromID.attachments.values();
		const message = {
			content: messageFromID.content,
			files: [],
		};

		for (const file of attachments) {
			message.files.push(file);
		}

		const job = nodeScheduler.scheduleJob(scheduleTime, async() => {
			await targetChannel.send(message);
		}
		);

		// save job to scheduler
		const id = jobScheduler.saveJob(targetChannel.id, `Copy message to ${targetChannel}: ${message.content.substring(0, 20)}...`, scheduleTime.toUTCString(), job);

		interaction.reply({
			content: `Job has been scheduled with id ${id} at ${scheduleTime.toUTCString()}`,
		});
	},
};
