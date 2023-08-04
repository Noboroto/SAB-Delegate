import ready from "./ready";
import interactionCreate from "./interactionCreate";
import messageCreate from "./messageCreate";
import messageUpdate from "./messageUpdate";

const events = [
    ready,
    interactionCreate,
    messageCreate,
    messageUpdate
];

export default events;