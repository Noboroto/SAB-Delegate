import { birthdayDb } from "./db";
import * as fs from "fs";

export const resetWishes = async (guid: string) => {
	const wisthesPath = "./files/birthday.json"
	const wishes: [] = JSON.parse(fs.readFileSync(wisthesPath, "utf8"));
	await birthdayDb.set(`${guid}.count`, wishes.length);
	await birthdayDb.set(`${guid}.max`, wishes.length);
	for (let id = 0; id < wishes.length; id++) {
		await birthdayDb.set(`${guid}.wishes.${id}`, true);
	}
}

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

	await birthdayDb.push(`${guid}.data.${month}.${day}`, { id, name, discordId });
}

export const getMonthList = async (guid: string, month: number): Promise<string> => {
	if (! await birthdayDb.get(guid)) {
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
}

export const removeBirthday = async (guid: string, id: string): Promise<String> => {
	const birthdays = await birthdayDb.get(guid);
	if (birthdays) {
		for (const month in birthdays) {
			for (const day in birthdays[month]) {
				if (birthdays[month][day].id === id) {
					delete birthdays[month][day];
				}
			}
		}
		await birthdayDb.set(guid, birthdays);

		return "Birthday removed";
	}
	return "No birthday found";
}

export const getWishID = async (guid: string): Promise<String> => {
	const guildObj = await birthdayDb.get(guid);

	if (guildObj === undefined || guildObj === null) {
		await resetWishes(guid);
	}
	if (await birthdayDb.get(`${guid}.count`) === 0) {
		await resetWishes(guid);
	}
	let maxMsg = await birthdayDb.get(`${guid}.max`);
	if (maxMsg === null || maxMsg === undefined || maxMsg === 0) {
		await resetWishes(guid);
		maxMsg = await birthdayDb.get(`${guid}.max`);
	}

	do {
		const randID = Math.floor(Math.random() * await birthdayDb.get(`${guid}.max`));
		const canWish = await birthdayDb.get(`${guid}.wishes.${randID}`);
		if (canWish && randID.toString() !== "NaN") {
			await birthdayDb.set(`${guid}.wishes.${randID}`, false);
			await birthdayDb.sub(`${guid}.count`, 1);
			return randID.toString();
		}
	} while (true);
}

export const getDateList = async (guid: string, month: number, day: number) => {
	const monthList = await birthdayDb.get(`${guid}.data.${month}`);
	if (monthList === undefined || monthList === null) {
		return []
	}
	const dayList = monthList[`${day}`];
	if (dayList === undefined || dayList === null) {
		return []
	}
	return dayList;
}

export const getServerIDs = async () => {
	const keys = (await birthdayDb.all()).map((key) => key.id);
	return keys;
}

export const setChannel = async (guid: string, channelId: string) => {
	await birthdayDb.set(`${guid}.channel`, channelId);
}

export const getChannel = async (guid: string) => {
	return await birthdayDb.get(`${guid}.channel`) ?? "";
}