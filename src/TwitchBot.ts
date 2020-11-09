import { IIrcBotConnectionConfig, IrcBot } from "./IrcBot";

export class TwitchBot extends IrcBot {
    public constructor(connection: IIrcBotConnectionConfig) {
        super({ connection, encoding: "utf8" });
    }
}