import { IChatWarriorState } from "./ChatWarrior";
import { GoogleAPIConfig } from "./google/GoogleAPI";
import { ITwitchBotConfig, ITwitchBotConnectionConfig, ITwitchUserDetail, TwitchUserDetail } from "./TwitchBotTypes";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface IChatWarriorUserDetail extends ITwitchUserDetail {
    chatWarriorState?: IChatWarriorState;
}

export class ChatWarriorUserDetail extends TwitchUserDetail implements IChatWarriorUserDetail {
    public chatWarriorState?: IChatWarriorState;
    
    public constructor(detail: IChatWarriorUserDetail) {
        super(detail);
        this.chatWarriorState = detail.chatWarriorState;
    }
}

export interface ISpudBotConfig extends ITwitchBotConfig {
    connection: ISpudBotConnectionConfig;
}

export interface ISpudBotConnectionConfig extends ITwitchBotConnectionConfig {
    google: GoogleAPIConfig;
}