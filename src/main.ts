import * as fs from "fs";
import { GbTwitchBot } from "./GhettoBotato";
import { IIrcBotConnectionConfig } from "./IrcBot";

const realPath = fs.realpathSync("./config/config.json");
console.log(`Looking for configuration at: ${realPath}`);
const configFileBuffer = fs.readFileSync(realPath);
const configFileStr = configFileBuffer.toString("utf8");
const config: IIrcBotConnectionConfig = JSON.parse(configFileStr)
console.log(`Configuration successfully read`);

const bot = new GbTwitchBot(config);
bot.startup();
