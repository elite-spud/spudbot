import { GoogleApiConnectionConfig } from "./google/GoogleAPI";
import { ITwitchBotConfig, ITwitchBotConnectionConfig } from "./TwitchApiTypes";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface ISpudBotConfig extends ITwitchBotConfig {
    connection: ISpudBotConnectionConfig;
}

export interface ISpudBotConnectionConfig extends ITwitchBotConnectionConfig {
    google: GoogleApiConnectionConfig;
}