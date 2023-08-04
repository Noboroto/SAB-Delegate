"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var ping_1 = __importDefault(require("./ping"));
var sendMessage_1 = __importDefault(require("./sendMessage"));
var commands = [
    ping_1.default,
    sendMessage_1.default
];
exports.default = commands;
//# sourceMappingURL=index.js.map