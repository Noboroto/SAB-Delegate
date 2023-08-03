"use strict";
// Require the necessary discord.js classes
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var discord_js_1 = require("discord.js");
var index_1 = __importDefault(require("events-bot/index"));
var config_1 = __importDefault(require("./config"));
// Create a new client instance
var client = new discord_js_1.Client({
    intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages, discord_js_1.GatewayIntentBits.MessageContent]
});
var _loop_1 = function (event_1) {
    if (event_1.once) {
        client.once(event_1.name, function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return event_1.execute.apply(event_1, args);
        });
    }
    else {
        client.on(event_1.name, function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return event_1.execute.apply(event_1, args);
        });
    }
};
for (var _i = 0, eventList_1 = index_1.default; _i < eventList_1.length; _i++) {
    var event_1 = eventList_1[_i];
    _loop_1(event_1);
}
client.login(config_1.default.token);
//# sourceMappingURL=index.js.map