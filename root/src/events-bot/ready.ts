import { Client, Events, Guild, TextChannel } from "discord.js";
import commands from "../commands";
import { claimOnce, happyBirthday, releaseClaim, reportError } from "../ultils";
import * as fs from "fs";
import scheduler from "node-schedule";

const wishesPath = "./constants/birthday.json";

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// Birthdays on 29 Feb are wished on 28 Feb in non-leap years.
const getTodayBirthdays = async (guildId: string, now: Date) => {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const users = [...(await happyBirthday.getDateList(guildId, month, day))];
  if (month === 2 && day === 28 && !isLeapYear(year)) {
    users.push(...(await happyBirthday.getDateList(guildId, 2, 29)));
  }
  return users;
};

const wishGuild = async (client: Client, guildId: string, wishes: string[]) => {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  // Guild rows belong to whichever bot is in that guild; others skip it.
  if (!guild) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // Every bot client runs this task; only one may wish a guild per day.
  const claim = `birthday:${guildId}:${year}-${month}-${day}`;
  if (!claimOnce(claim)) return;
  try {
    await wishGuildToday(guild, now, wishes);
  } catch (error) {
    releaseClaim(claim);
    throw error;
  }
};

const wishGuildToday = async (guild: Guild, now: Date, wishes: string[]) => {
  const guildId = guild.id;
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (await happyBirthday.getIsCompleteDate(guildId, year, month, day)) {
    console.info(`Birthday for guild ${guild.name} is already complete`);
    return;
  }

  const channelId = await happyBirthday.getChannel(guildId);
  if (channelId === "") {
    console.info(`No birthday channel set for guild ${guild.name}`);
    return;
  }

  const birthdayUsers = await getTodayBirthdays(guildId, now);
  if (birthdayUsers.length === 0) {
    console.info(`No birthday for guild ${guild.name}`);
    return;
  }

  const channel = (await guild.channels.fetch(channelId)) as TextChannel;
  console.info(
    `Sending ${birthdayUsers.length} birthday wish(es) to ${channel.name}`
  );
  for (const user of birthdayUsers) {
    const msgID = Number(await happyBirthday.getWishID(guildId));
    const msg = wishes[msgID].replaceAll("${name}", `<@${user.discordId}>`);
    await channel.send(msg);
  }
  await happyBirthday.setIsCompleteDate(guildId, year, month, day, true);
  console.info(`Set birthday complete for guild ${guild.name}`);
};

const birthdayTask = async (client: Client) => {
  try {
    const wishes: string[] = JSON.parse(fs.readFileSync(wishesPath, "utf8"));
    await happyBirthday.setMaxWishes(wishes.length);

    for (const guildId of await happyBirthday.getServerIDs()) {
      await wishGuild(client, guildId, wishes).catch((error) =>
        reportError(client, `Birthday task failed for guild ${guildId}`, error)
      );
    }
  } catch (error) {
    await reportError(client, "Birthday task failed", error);
  }
};

const registerCommands = async (client: Client) => {
  await client.application.commands.set([]);
  console.info(
    `${client.user?.username} Successfully deleted application command`
  );

  const results = await Promise.allSettled(
    commands.map((command) => client.application.commands.create(command.data))
  );
  results.forEach((result, index) => {
    const name = commands[index].data.name;
    if (result.status === "fulfilled") {
      console.info(
        `${client.user?.username} Successfully registered application command "${name}"`
      );
    } else {
      console.error(
        `${client.user?.username} Error registering application command "${name}"\n${result.reason}`
      );
    }
  });
};

export default {
  name: Events.ClientReady,
  once: true,
  async execute(args: Client[]) {
    const client = args[0];
    console.info(`Ready! Logged in as ${client.user?.username}`);

    // Registration-only run: re-register slash commands and disconnect without
    // starting the birthday cron (it would keep the process alive and post wishes).
    if (process.env.CREATE_CMD && process.env.CREATE_CMD !== "0") {
      try {
        await registerCommands(client);
      } finally {
        await client.destroy();
      }
      return;
    }

    console.info("Production Mode");
    scheduler.scheduleJob("0 0 0 * * *", async () => {
      console.info(`${client.user?.username} Running birthday task`);
      await birthdayTask(client);
    });
    await birthdayTask(client);
  },
};
