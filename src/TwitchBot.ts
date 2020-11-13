import { IIrcBotAuxCommandGroupConfig, IIrcBotConnectionConfig, IrcBot } from "./IrcBot";

export class TwitchBot extends IrcBot {
    public constructor(
            connection: IIrcBotConnectionConfig,
            auxCommandGroups: IIrcBotAuxCommandGroupConfig[]) {
        super({ connection, encoding: "utf8", auxCommandGroups });
    }
}