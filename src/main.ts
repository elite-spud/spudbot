import * as fs from "fs";
import { GhettoBotatoTwitchBot } from "./GhettoBotato";
import { IIrcBotAuxCommandGroupConfig } from "./IrcBot";
import { ITwitchBotConnectionConfig } from "./TwitchBot";

const connectionConfigPath = fs.realpathSync("./config/config.json");
const commandConfigPath = fs.realpathSync("./config/commands.json");
const userDetailsPath = fs.realpathSync("./config/twitchUsers.json");

const connectionConfig = loadJsonFile<ITwitchBotConnectionConfig>(connectionConfigPath);
const commands = loadJsonFile<IIrcBotAuxCommandGroupConfig[]>(commandConfigPath);

const bot = new GhettoBotatoTwitchBot(connectionConfig, commands, userDetailsPath);
bot.startup();

export function loadJsonFile<T>(filePath: string): T {
    const realPath = fs.realpathSync(filePath);
    console.log(`Looking for configuration at: ${realPath}`);
    const fileBuffer = fs.readFileSync(realPath);
    const fileStr = fileBuffer.toString("utf8");
    const config: T = JSON.parse(fileStr)
    console.log(`Configuration successfully read`);
    return config;
}