"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var discord_js_1 = require("discord.js");
var commands_1 = __importDefault(require("../commands"));
exports.default = {
    name: discord_js_1.Events.ClientReady,
    once: true,
    execute: function (args) {
        var _a;
        var client = args[0];
        console.log("Ready! Logged in as ".concat((_a = client.user) === null || _a === void 0 ? void 0 : _a.tag));
        client.application.commands.set([]).then(function () { return console.log("Successfully deleted application command"); });
        console.log();
        var _loop_1 = function (command) {
            client.application.commands
                .create(command.data)
                .then(function () { return console.log("Successfully registered application command \"".concat(command.data.name, "\"")); })
                .catch(function (error) {
                return console.error("Error registering application command \"".concat(command.data.name, "\"\n").concat(error));
            });
        };
        for (var _i = 0, commands_2 = commands_1.default; _i < commands_2.length; _i++) {
            var command = commands_2[_i];
            _loop_1(command);
        }
    }
};
//# sourceMappingURL=ready.js.map