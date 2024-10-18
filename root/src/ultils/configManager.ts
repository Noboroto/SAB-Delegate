import { configDb } from "./db";

export const getIntroChannelId = async (guildId: string) => {
	return await configDb.get(`${guildId}.intro_channel`);
}

export const setIntroChannelId = async (guildId: string, channelId: string) => {
	await configDb.set(`${guildId}.intro_channel`, channelId);
}