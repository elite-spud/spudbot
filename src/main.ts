import * as fs from "fs";
import { IIrcBotMiscConfig, ISimpleCommandGroup_Config } from "./IrcBot";
import { SpudBotTwitch } from "./SpudBot";
import { ISpudBotConnectionConfig } from "./SpudBotTypes";
import { ISimpleCommand_ConfigTwitch } from "./TwitchApiTypes";

const configDir = fs.realpathSync(`./config`);
const miscConfigPath = fs.realpathSync(`${configDir}/miscConfig.json`);
const connectionConfigPath = fs.realpathSync(`${configDir}/connection.json`);
const commandConfigPath = fs.realpathSync(`${configDir}/commands.json`);

const miscConfig = loadJsonFile<IIrcBotMiscConfig>(miscConfigPath);
const connectionConfig = loadJsonFile<ISpudBotConnectionConfig>(connectionConfigPath);
const commands = loadJsonFile<ISimpleCommandGroup_Config<ISimpleCommand_ConfigTwitch>[]>(commandConfigPath);

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