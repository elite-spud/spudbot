import * as fs from "fs";
import { IIrcBotAuxCommandGroupConfig, IIrcBotMiscConfig } from "./IrcBot";
import { SpudBotTwitch } from "./SpudBot";
import { ISpudBotConnectionConfig } from "./SpudBotTypes";

const configDir = fs.realpathSync(`./config`);
const miscConfigPath = fs.realpathSync(`${configDir}/miscConfig.json`);
const connectionConfigPath = fs.realpathSync(`${configDir}/connection.json`);
const commandConfigPath = fs.realpathSync(`${configDir}/commands.json`);

const miscConfig = loadJsonFile<IIrcBotMiscConfig>(miscConfigPath);
const connectionConfig = loadJsonFile<ISpudBotConnectionConfig>(connectionConfigPath);
const commands = loadJsonFile<IIrcBotAuxCommandGroupConfig[]>(commandConfigPath);

const bot = new SpudBotTwitch(miscConfig, connectionConfig, commands, configDir);
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