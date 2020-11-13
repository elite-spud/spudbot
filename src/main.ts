import * as fs from "fs";
import { GbTwitchBot } from "./GhettoBotato";
import { IIrcBotAuxCommandGroupConfig, IIrcBotConnectionConfig } from "./IrcBot";

const connectionConfigPath = fs.realpathSync("./config/config.json");
const commandConfigPath = fs.realpathSync("./config/commands.json");

const connectionConfig = loadJsonFile<IIrcBotConnectionConfig>(connectionConfigPath);
const commands = loadJsonFile<IIrcBotAuxCommandGroupConfig[]>(commandConfigPath);

const bot = new GbTwitchBot(connectionConfig, commands);
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