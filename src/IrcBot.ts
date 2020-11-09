
import * as net from "net";

export interface IIrcBotConnectionConfig {
    user: {
        nick: string;
        pass: string;
    },
    server: {
        host: string;
        port: number;
        channels: string[]
    }
}

export class IIrcBotConfig {
    connection: IIrcBotConnectionConfig;
    encoding: "utf8" | "ascii" | string;
}

export abstract class IrcBot {
    protected readonly responseHandlers: ((data: string) => void)[] = [];
    protected readonly socket: net.Socket;

    constructor(protected readonly config: IIrcBotConfig) {
        this.socket = new net.Socket()
        this.socket.setNoDelay();

        this.responseHandlers.push((data) => this.handlePing(data));
    }

    public startup(): void {
        this.socket.on("connect", () => this.onConnect());
        this.socket.on("data", (data) => this.onData(data));

        this.socket.connect(this.config.connection.server.port, this.config.connection.server.host);
    }

    protected onConnect(): void {
        console.log("Connected successfully");
        setTimeout(() => {
            this.socket.write(`PASS ${this.config.connection.user.pass}\r\n`);
            this.socket.write(`NICK ${this.config.connection.user.nick}\r\n`);
            for (const channel of this.config.connection.server.channels) {
                this.socket.write(`JOIN #${channel}\r\n`);
            }
        }, 2000);
    }

    protected onData(data: Buffer): void {
        console.log("Received Data");

        const dataStr = data.toString(this.config.encoding);
        const printStr = dataStr.split("\r\n").join("\r\n  ").trimEnd();
        console.log(`  ${printStr}\n`);
        this.handleResponse(dataStr);
    }

    protected handleResponse(data: string) {
        const handlers = this.responseHandlers;
        for (const handler of handlers) {
            try {
                handler(data);
            } catch (err) {
                console.log("Error processing response: ")
                console.log(err);
            }
        }
    }

    protected handlePing(data: string): void {
        const pattern = /^PING :(.+)[\r\n]+$/;
        const regexArray = pattern.exec(data);
        if (regexArray === null || regexArray === undefined) {
            return;
        }

        this.sendRaw(`PONG :${regexArray[1]}\r\n`);
    }

    protected sendRaw(data: string): void {
        if (!data.endsWith("\r\n")) {
            data += "\r\n";
        }
        this.socket.write(data);
        console.log("Sent Data")
        const printStr = data.split("\r\n").join("\r\n  ").trimEnd();
        console.log(`  ${printStr}\n`);
    }

    protected parseChatMessage(privMessage: string): { username: string, message: string, recipient: string, hostname: string } | undefined{
        const pattern = /^:(\w+)!(\w+@[\w.]+) PRIVMSG ([#\w]+) :(.+)\r?\n?/;
        const regexArray = pattern.exec(privMessage);
        if (regexArray === undefined || regexArray === null) {
            return undefined;
        }

        return {
            username: regexArray[1],
            hostname: regexArray[2],
            recipient: regexArray[3],
            message: regexArray[4],
        };
    }

    protected chat(recipient: string, message: string): void {
        this.sendRaw(`PRIVMSG ${recipient} :${message}\r\n`);
    }
}