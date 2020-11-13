import { Dictionary } from "./Dictionary";
import { IIrcBotAuxCommandGroupConfig, IIrcBotConnectionConfig, IMessageDetails } from "./IrcBot";
import { TwitchBot } from "./TwitchBot";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export function compareStrings(left: string, right: string): number { return left === right ? 0 : (left < right ? -1 : 1); }

export class GbTwitchBot extends TwitchBot {
    protected readonly messageDetailCache: Dictionary<string, IMessageDetails> = new Dictionary(compareStrings);

    public constructor(connection: IIrcBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[]) {
        super(connection, auxCommandGroups);
        this._hardcodedResponseHandlers.push((data) => this.handleEcho(data));
    }

    protected parseChatMessage(privMessage: string): IMessageDetails | undefined {
        if (this.messageDetailCache[privMessage] !== undefined) {
            return this.messageDetailCache[privMessage];
        }

        const chatDetails = super.parseChatMessage(privMessage);
        this.messageDetailCache[privMessage] = chatDetails;
        setTimeout(() => {
            this.messageDetailCache[privMessage] = undefined;
        }, 1000)

        return chatDetails;
    }

    protected handleEcho(data: string): void {
        const details = this.parseChatMessage(data);
        if (details === undefined) {
            return;
        }

        console.log("Parsed chat message")
        console.log(details);

        const messageArr = details.message.split(" ");
        if (messageArr[0] !== "!echo") {
            return;
        }

        const response = messageArr.slice(1).join(" ");
        this.chat(details.recipient, response);
    }

    protected handleEditCom(data: string): void {

    }
}