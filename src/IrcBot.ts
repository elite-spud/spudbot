
import { randomInt } from "crypto";
import * as net from "net";

export interface IIrcBotConnectionConfig {
    user: {
        nick: string;
        pass: string;
    },
    server: {
        host: string;
        port: number;
        channels: {
            name: string;
            timers: boolean;
        }[];
    }
}

export interface IIrcBotAuxCommandGroupConfig {
    timerMinutes: number;
    timerMinutesOffset?: number;
    random: boolean;
    commands: IIrcBotAuxCommandConfig[];
}

export interface IIrcBotAuxCommandConfig {
    names: string[];
    response: string;
}

export interface IMessageDetails {
    username: string;
    message: string;
    recipient: string;
    hostname: string;
}

export class TimerGroup {
    protected _intervalId?: NodeJS.Timeout;

    public constructor(
        protected _commands: (() => void)[],
        protected readonly _delayMinutes: number,
        protected readonly _offsetMinutes: number = 0,
        protected readonly _randomizeCommands: boolean = false) {
    }

    public startTimer(): void {
        if (this._commands.length === 0) {
            return;
        }
        
        let currentIndex = 0;
        let intervalCommands = this._commands;
        if (!!this._randomizeCommands) {
            const orderedCommands = this._commands;
            const shuffledCommands = [];
            while (orderedCommands.length > 0) {
                const index = randomInt(orderedCommands.length);
                shuffledCommands.push(orderedCommands[index]);
                orderedCommands.splice(index, 1);
            }
            intervalCommands = shuffledCommands;
        }
        
        const delayMillis = this._offsetMinutes * 60 * 1000;
        setTimeout(() => {
            const intervalMillis = this._delayMinutes * 60 * 1000;
            this._intervalId = setInterval(() => {
                console.log(currentIndex);
                intervalCommands[currentIndex]();
                currentIndex = currentIndex === intervalCommands.length - 1
                    ? 0
                    : currentIndex + 1;
            }, intervalMillis);
        }, delayMillis);
    }

    public stopTimer(): void {
        clearInterval(this._intervalId);
    }
}

export abstract class IrcBot {
    /** Hardcoded responses are kept separate from those read from a configuration to allow interactive editing of configured commands */
    protected readonly _hardcodedResponseHandlers: ((data: string) => void)[] = [];
    protected readonly _configuredResponseHandlers: ((data: string) => void)[] = [];
    protected readonly _configuredTimerGroups: TimerGroup[] = [];
    protected readonly _socket: net.Socket;

    public constructor(protected readonly config: {
        connection: IIrcBotConnectionConfig,
        encoding: "utf8" | "ascii" | string,
        auxCommandGroups: IIrcBotAuxCommandGroupConfig[],
    }) {
        this._socket = new net.Socket();
        this._socket.setNoDelay();

        this._hardcodedResponseHandlers.push((data) => this.handlePing(data));

        const channelsToAddTimers = config.connection.server.channels.filter(channel => !!channel.timers).map(channel => channel.name);
        const configCommands = this.getCommandsFromConfig(config.auxCommandGroups, channelsToAddTimers);

        this._configuredResponseHandlers = configCommands.chatResponses;
        this._configuredTimerGroups = configCommands.timerGroups;
        this._configuredTimerGroups.forEach(timer => timer.startTimer());
    }

    protected getCommandsFromConfig(commandGroups: IIrcBotAuxCommandGroupConfig[], channelsToAddTimers: string[]) {
        const chatResponses: ((data: string) => void)[] = [];
        const timerGroups: TimerGroup[] = [];
        
        for (const commandGroup of commandGroups) {
            const timerCommands = [];
            for (const command of commandGroup.commands) {
                channelsToAddTimers.forEach(channel => timerCommands.push(() => this.chat(channel, command.response)));

                for (const name of command.names) {
                    const func = this.getSimpleChatResponseFunc(name, command.response);
                    chatResponses.push(func);
                }
            }

            if (commandGroup.timerMinutes !== null && commandGroup.timerMinutes !== undefined) {
                const timerGroup = new TimerGroup(timerCommands, commandGroup.timerMinutes, commandGroup.timerMinutesOffset, commandGroup.random);
                timerGroups.push(timerGroup);
            }
        }

        return { chatResponses, timerGroups };
    }

    public getSimpleChatResponseFunc(triggerPhrase: string, response: string): (data: string) => void {
        const wordsInTriggerPhrase = triggerPhrase.trim().split(" ").length;
        const func = (data: string) => {
            const messageDetail = this.parseChatMessage(data);
            if (messageDetail === undefined) {
                return;
            }
            const messageArr = messageDetail.message.trim().split(" ");
            const messageSection = messageArr.slice(0, wordsInTriggerPhrase).join(" ");
            if (messageSection === triggerPhrase) {
                const messageWasSentToChannel = messageDetail.recipient[0] === "#";
                const recipient = messageWasSentToChannel ? messageDetail.recipient : messageDetail.username;
                this.chat(recipient, response);
            }
        }
        return func;
    }

    public startup(): void {
        this._socket.on("connect", () => this.onConnect());
        this._socket.on("data", (data) => this.onData(data));

        this._socket.connect(this.config.connection.server.port, this.config.connection.server.host);
    }

    protected onConnect(): void {
        console.log("Connected successfully");
        setTimeout(() => {
            this._socket.write(`PASS ${this.config.connection.user.pass}\r\n`);
            this._socket.write(`NICK ${this.config.connection.user.nick}\r\n`);
            for (const channel of this.config.connection.server.channels) {
                this._socket.write(`JOIN ${channel.name}\r\n`);
            }
        }, 1000);
    }

    protected onData(data: Buffer): void {
        console.log("Received Data");

        const dataStr = data.toString(this.config.encoding);
        const printStr = dataStr.split("\r\n").join("\r\n  ").trimEnd();
        console.log(`  ${printStr}\n`);
        this.handleResponse(dataStr);
    }

    protected handleResponse(data: string) {
        const handlers = this._configuredResponseHandlers.concat(this._hardcodedResponseHandlers);

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
        this._socket.write(data);
        console.log("Sent Data")
        const printStr = data.split("\r\n").join("\r\n  ").trimEnd();
        console.log(`  ${printStr}\n`);
    }

    protected parseChatMessage(privMessage: string): IMessageDetails | undefined {
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