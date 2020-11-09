import { IIrcBotConnectionConfig } from "./IrcBot";
import { TwitchBot } from "./TwitchBot";

export class GbTwitchBot extends TwitchBot {
    public constructor(connection: IIrcBotConnectionConfig) {
        super(connection);
        this.responseHandlers.push((data) => this.handleEcho(data));
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
}