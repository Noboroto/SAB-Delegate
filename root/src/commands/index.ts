import ping from "./ping";
import sendMessage from "./sendMessage";
import copyToChannel from "./copyToChannel";
import editBotMessage from "./editBotMessage";
import bulkRole from "./bulkRole";
import reactMessaage from "./reactMessaage";
import addNoteByRole from "./addNoteByRole";
import removeNoteByRole from "./removeNoteByRole";
import getNoteByRole from "./getNoteByRole";
import checkAttandance from "./checkAttandance";

const commands = [
	ping,
	sendMessage,
	copyToChannel,
	editBotMessage,
	bulkRole,
	reactMessaage,
	addNoteByRole,
	removeNoteByRole,
	getNoteByRole,
	checkAttandance,
];

export default commands;
