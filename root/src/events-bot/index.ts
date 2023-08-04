import ready from "./ready";
import interactionCreate from "./interactionCreate";
import messageCreate from "./messageCreate";

const events = [
    ready,
    interactionCreate,
    messageCreate
];

export default events;