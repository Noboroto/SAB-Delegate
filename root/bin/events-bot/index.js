"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var ready_1 = __importDefault(require("./ready"));
var interactionCreate_1 = __importDefault(require("./interactionCreate"));
var events = [
    ready_1.default,
    interactionCreate_1.default
];
exports.default = events;
//# sourceMappingURL=index.js.map