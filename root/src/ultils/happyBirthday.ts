import { birthdayDb } from "./db";
import * as fs from "fs";

export const setIsCompleteDate = async (
  guid: string,
  month: number,
  day: number,
  status: Boolean = true
) => {
  await birthdayDb.set(`${guid}.isCompleted.${month}.${day}`, status);
};

export const getIsCompleteDate = async (
  guid: string,
  month: number,
  day: number
) => {
  const data = await birthdayDb.get(`${guid}.isCompleted.${month}.${day}`);
  return data;
};

export const resetWishes = async (guid: string) => {
  const wisthesPath = "./constants/birthday.json";
  const wishes: [] = JSON.parse(fs.readFileSync(wisthesPath, "utf8"));
  await birthdayDb.set(`${guid}.count`, wishes.length);
  await birthdayDb.set(`max`, wishes.length);
  for (let id = 0; id < wishes.length; id++) {
    await birthdayDb.set(`${guid}.wishes.${id}`, true);
  }
};

export const appendBirthday = async (
  guid: string,
  id: string,
  name: string,
  discordId: string,
  day: number,
  month: number
) => {
  const dataObj = await birthdayDb.get(`${guid}.data`);
  if (dataObj === undefined || dataObj === null) {
    await birthdayDb.set(`${guid}.data`, {});
  }
  const monthObj = await birthdayDb.get(`${guid}.data.${month}`);
  if (monthObj === undefined || monthObj === null) {
    await birthdayDb.set(`${guid}.data.${month}`, {});
  }
  const dayObj = await birthdayDb.get(`${guid}.data.${month}.${day}`);
  if (dayObj === undefined || dayObj === null) {
    await birthdayDb.set(`${guid}.data.${month}.${day}`, []);
  }
  discordId = discordId.trimEnd().trimStart();
  await birthdayDb.push(`${guid}.data.${month}.${day}`, {
    id,
    name,
    discordId,
  });
};

export const getMonthList = async (
  guid: string,
  month: number
): Promise<string> => {
  if (!(await birthdayDb.get(guid))) {
    await resetWishes(guid);
  }
  const monthList = await birthdayDb.get(`${guid}.data.${month}`);
  if (monthList === undefined || monthList === null) {
    return "No birthdays found";
  }
  const keys = Object.keys(monthList).sort((a, b) => Number(a) - Number(b));
  let returnString = "";
  for (const day of keys) {
    returnString += `### Day ${day}:\n`;
    for (const person of monthList[day]) {
      returnString += `${person.id} - ${person.name} - ${person.discordId}\n`;
    }
  }
  return returnString;
};

export const removeBirthday = async (
  guid: string,
  id: string
): Promise<String> => {
  const data = await birthdayDb.get(`${guid}.data`);
  if (!data) return "No birthday found";

  let found = false;
  for (const month in data) {
    for (const day in data[month]) {
      if (!Array.isArray(data[month][day])) continue;
      const filtered = data[month][day].filter((person) => person.id !== id);
      if (filtered.length !== data[month][day].length) {
        found = true;
        data[month][day] = filtered;
      }
    }
  }

  if (!found) return "No birthday found";

  await birthdayDb.set(`${guid}.data`, data);
  return "Birthday removed";
};

export const removeBirthdayByDiscord = async (
  guid: string,
  discordId: string
): Promise<String> => {
  const data = await birthdayDb.get(`${guid}.data`);
  if (!data) return "No birthday found";

  let found = false;
  for (const month in data) {
    for (const day in data[month]) {
      if (!Array.isArray(data[month][day])) continue;
      const filtered = data[month][day].filter(
        (person) => person.discordId !== discordId
      );
      if (filtered.length !== data[month][day].length) {
        found = true;
        data[month][day] = filtered;
      }
    }
  }

  if (!found) return "No birthday found for this user";

  await birthdayDb.set(`${guid}.data`, data);
  return "Birthday removed";
};

export const getWishID = async (guid: string): Promise<String> => {
  const guildObj = await birthdayDb.get(guid);

  if (guildObj === undefined || guildObj === null) {
    console.info("Reset wishes because guildObj is null");
    await resetWishes(guid);
  }
  if ((await birthdayDb.get(`${guid}.count`)) === 0) {
    console.info("Reset wishes because count is 0");
    await resetWishes(guid);
  }
  let maxMsg = await birthdayDb.get(`max`);
  if (maxMsg === null || maxMsg === undefined || maxMsg === 0) {
    console.info("Reset wishes because maxMsg is 0");
    await resetWishes(guid);
    maxMsg = await birthdayDb.get(`max`);
  }

  const maxRetries = 1000;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const max = await birthdayDb.get(`max`);
    if (!max || max === 0) {
      await resetWishes(guid);
      continue;
    }
    const count = await birthdayDb.get(`${guid}.count`);
    if (count === 0) {
      await resetWishes(guid);
    }
    const randID = Math.floor(Math.random() * max);
    const canWish = await birthdayDb.get(`${guid}.wishes.${randID}`);
    if (canWish === true) {
      await birthdayDb.set(`${guid}.wishes.${randID}`, false);
      await birthdayDb.sub(`${guid}.count`, 1);
      return randID.toString();
    }
  }
  // Fallback: reset and return first wish
  await resetWishes(guid);
  await birthdayDb.set(`${guid}.wishes.0`, false);
  await birthdayDb.sub(`${guid}.count`, 1);
  return "0";
};

export const getDateList = async (guid: string, month: number, day: number) => {
  const monthList = await birthdayDb.get(`${guid}.data.${month}`);
  if (monthList === undefined || monthList === null) {
    return [];
  }
  const dayList = monthList[`${day}`];
  if (dayList === undefined || dayList === null) {
    return [];
  }
  return dayList;
};

export const getServerIDs = async () => {
  const keys = (await birthdayDb.all()).map((key) => key.id);
  return keys;
};

export const setChannel = async (guid: string, channelId: string) => {
  await birthdayDb.set(`${guid}.channel`, channelId);
};

export const getChannel = async (guid: string) => {
  return (await birthdayDb.get(`${guid}.channel`)) ?? "";
};

export const setMaxWishes = async (newMax: number) => {
  const oldMax = await birthdayDb.get(`max`);
  await birthdayDb.set(`max`, newMax);
  const keys = await getServerIDs();
  for (const guids of keys) {
    for (let id = oldMax; id < newMax; id++) {
      await birthdayDb.set(`${guids}.wishes.${id}`, true);
    }
  }
};
