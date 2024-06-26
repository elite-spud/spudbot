import { IChatWarriorState } from "./ChatWarrior";
import { GoogleAPIConfig } from "./GoogleAPI";
import { ITwitchBotConfig, ITwitchBotConnectionConfig, ITwitchUserDetail } from "./TwitchBotTypes";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface IChatWarriorUserDetail extends ITwitchUserDetail {
    chatWarriorState?: IChatWarriorState;
}

export interface ISpudBotConfig extends ITwitchBotConfig {
    connection: ISpudBotConnectionConfig;
}

export interface ISpudBotConnectionConfig extends ITwitchBotConnectionConfig {
    google: GoogleAPIConfig;
}