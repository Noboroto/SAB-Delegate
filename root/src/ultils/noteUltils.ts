import { noteDb } from "./db"

export const saveNote = async(roleID: string, topic: string, note: string): Promise<void> => {
	await noteDb.set(`${roleID}.topic`, note);
}

export const getNote = async(roleID: string): Promise<string> => {
	return JSON.stringify(await noteDb.get(`${roleID}`), null, 2);
}

export const removeNote = async(roleID: string, topic: string): Promise<void> => {
	await noteDb.delete(`${roleID}.topic`);
}