import ping from "./ping";
import attandanceByRole from "./attandanceByRole";
import bulkRole from "./bulkAssign";
import mention from "./mention";
import addPoll from "./addPoll";
import get from "./get";
import createActivity from "./createActivity";
import note from "./note";
import word from "./word";
import botMessage from "./botMessage";
import scheduler from "./scheduler";
import privateThread from "./privateThread";
import thread from "./thread";
import shutdown from "./shutdown";
import birthday from "./birthday";
import set from "./set";

const commands = [
  word,
  thread,
  addPoll,
  attandanceByRole,
  botMessage,
  bulkRole,
  createActivity,
  get,
  mention,
  note,
  ping,
  privateThread,
  scheduler,
  shutdown,
	birthday,
	set
].sort((a, b) => {
  if (a.data.name < b.data.name) {
    return -1;
  }
  if (a.data.name > b.data.name) {
    return 1;
  }
  return 0;
});
export default commands;
