"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Require the necessary discord.js classes
var discord_js_1 = require("discord.js");
var index_1 = __importDefault(require("./events-bot/index"));
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
            return event_1.execute(__spreadArray([], args, true));
        });
    }
    else {
        client.on(event_1.name, function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return event_1.execute(__spreadArray([], args, true));
        });
    }
};
for (var _i = 0, events_1 = index_1.default; _i < events_1.length; _i++) {
    var event_1 = events_1[_i];
    _loop_1(event_1);
}
client.login(config_1.default.token);
//# sourceMappingURL=index.js.map