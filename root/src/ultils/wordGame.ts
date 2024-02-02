import { dictDb, wordDb } from "./db";
/**
 * return the channel of the word game
 * @param guildID
 * @param channelID
 * @param maxWords
 * @returns
 */
export const setWordGame = async (
	guildID: string,
	channelID: string = null,
	maxWords: number = null
): Promise<string> => {

	if (channelID) await wordDb.set(`${guildID}.channelID`, channelID);
	await wordDb.set(`${guildID}.start`, true);
	await wordDb.set(`${guildID}.wordArray`, []);
	if (maxWords) await wordDb.set(`${guildID}.maxWords`, maxWords);
	await wordDb.set(`${guildID}.lastUser`, "");
	await wordDb.set(`${guildID}.lastWord`, "");
	return await wordDb.get(`${guildID}.channelID`);
};

export const isValidChannel = async (
	guildID: string,
	channelID: string
): Promise<boolean> => {
	const wordChannel = await wordDb.get(`${guildID}.channelID`);
	if (!wordChannel) return false;
	return (wordChannel === channelID);
};

export enum WordGameStatus {
	SUCCESS,
	SAME_AUTHOR,
	SAME_WORD,
	NOT_EXIST,
	NOT_LINK,
}

export const getWordStatus = async (
	guildID: string,
	word: string,
	authorID: string
): Promise<WordGameStatus> => {
	const query = word.toLowerCase();
	const isStart: boolean = await wordDb.get(`${guildID}.start`);
	const wordArr: string[] = await wordDb.get(`${guildID}.wordArray`);
	const lastWord: string = await wordDb.get(`${guildID}.lastWord`);
	const lastUser: string = await wordDb.get(`${guildID}.lastUser`);

	if (!isStart) {
		if (lastUser === authorID) return WordGameStatus.SAME_AUTHOR;
		if (wordArr.includes(query)) return WordGameStatus.SAME_WORD;
		if (!word.startsWith(lastWord.slice(-1))) return WordGameStatus.NOT_LINK;
	}
	if (!await dictDb.get(`dict.${query}`)) return WordGameStatus.NOT_EXIST;

	return WordGameStatus.SUCCESS;
};

export const setWord = async (
	guildID: string,
	word: string,
	authorID: string
): Promise<void> => {
	await wordDb.push(`${guildID}.wordArray`, word.toLowerCase());
	await wordDb.set(`${guildID}.lastUser`, authorID);
	await wordDb.set(`${guildID}.lastWord`, word.toLowerCase());
	await wordDb.set(`${guildID}.start`, false);
};

export const getStarter = async (guildID: string): Promise<string> => {
	const lastWord: string = await wordDb.get(`${guildID}.lastWord`);
	return lastWord.slice(-1);
};
