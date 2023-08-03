"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var discord_js_1 = require("discord.js");
exports.default = {
    name: discord_js_1.Events.ClientReady,
    once: true,
    execute: function (client) {
        var _a;
        console.log("Ready! Logged in as ".concat((_a = client.user) === null || _a === void 0 ? void 0 : _a.tag));
    }
};
//# sourceMappingURL=ready.js.map