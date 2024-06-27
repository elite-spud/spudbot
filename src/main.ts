import * as fs from "fs";
import { SpudBotTwitch } from "./SpudBot";
import { IIrcBotAuxCommandGroupConfig } from "./IrcBot";
import { ISpudBotConnectionConfig } from "./SpudBotTypes";

const configDir = fs.realpathSync(`./config`);
const connectionConfigPath = fs.realpathSync(`${configDir}/config.json`);
const commandConfigPath = fs.realpathSync(`${configDir}/commands.json`);

const connectionConfig = loadJsonFile<ISpudBotConnectionConfig>(connectionConfigPath);
const commands = loadJsonFile<IIrcBotAuxCommandGroupConfig[]>(commandConfigPath);

const bot = new SpudBotTwitch(connectionConfig, commands, configDir);
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