import { randomInt } from "crypto";
import * as net from "net";
import { ConsoleColors } from "./ConsoleColors";
import { TimerGroup } from "./TimerGroup";

export interface IIrcBotConfig<TUserDetail extends IUserDetail> {
    connection: IIrcBotConnectionConfig,
    encoding: "utf8" | "ascii" | string,
    auxCommandGroups: IIrcBotAuxCommandGroupConfig[],
    userDetails: IUserDetails<TUserDetail>,
}

export interface IIrcBotConnectionConfig {
    user: {
        nick: string;
        pass: string;
    },
    server: {
        host: string;
        port: number;
        channel: string;
    },
}

export interface IIrcBotAuxCommandGroupConfig {
    timerMinutes: number;
    timerMinutesOffset?: number;
    random: boolean;
    commands: IIrcBotAuxCommandConfig[];
}

export interface IUserDetails<TUserDetail extends IUserDetail> {
    [key: string]: TUserDetail;
}

export interface IUserDetail {
    username: string;
    secondsInChat: string;
}

export interface IIrcBotAuxCommandConfig {
    names: string[];
    strict?: boolean; // Matches names exactly (ignoring whitespace)
    responses: string[];
}

export interface IMessageDetail {
    command: "PING" | "PRIVMESSAGE" | "JOIN" | string;
}

export interface IJoinMessageDetail {
    username: string;
    hostname: string;
    channel: string;
    command: "JOIN";
}

export interface IPartMessageDetail {
    username: string;
    hostname: string;
    channel: string;
    command: "PART";
}

export interface IPingMessageDetail extends IMessageDetail {
    command: "PING";
    hostname: string;
}

export interface IPrivMessageDetail {
    command: "PRIVMESSAGE";
    tags?: string;
    username: string;
    hostname: string;
    recipient: string;
    message: string;
    respondTo: string;
}

export enum UserChatStatus {
    Disconnected = 0,
    BeingAdded = 1,
    Connected = 2,
}

export abstract class IrcBot<TUserDetail extends IUserDetail> {
    /** Hardcoded responses are kept separate from those read from a configuration to allow interactive editing of configured commands */
    protected readonly _hardcodedResponseHandlers: ((message: IPrivMessageDetail) => void)[] = [];
    protected readonly _configuredResponseHandlers: ((message: IPrivMessageDetail) => void)[] = [];
    protected readonly _configuredTimerGroups: TimerGroup[] = [];
    protected readonly _socket: net.Socket;
    protected readonly _privMessageDetailCache: { [key: string]: IPrivMessageDetail } = {};

    protected readonly _userDetails: IUserDetails<TUserDetail>;
    protected readonly _usersInChat: { [key: string]: UserChatStatus } = {};

    public constructor(protected readonly _config: IIrcBotConfig<TUserDetail>) {
        this._socket = new net.Socket();
        this._socket.setNoDelay();

        const configCommands = this.getCommandsFromConfig(_config.auxCommandGroups, _config.connection.server.channel);
        this._configuredResponseHandlers = configCommands.chatResponses;
        this._configuredTimerGroups = configCommands.timerGroups;
        this._configuredTimerGroups.forEach(timer => timer.startTimer());
        
        this._userDetails = _config.userDetails;

        setInterval(() => this.trackUsersInChat(), 1000 * 30);
    }

    protected trackUsersInChat(): void {
        console.log("Users in chat:");
        console.log(this._usersInChat);
        console.log((this as any)._twitchIdByUsername);
        // TODO: merge records for users with both username and twitch id (in TwitchBot)
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    protected getCommandsFromConfig(commandGroups: IIrcBotAuxCommandGroupConfig[], channelToAddTimers: string | undefined) {
        const chatResponses: ((messageDetail: IPrivMessageDetail) => void)[] = [];
        const timerGroups: TimerGroup[] = [];
        
        for (const commandGroup of commandGroups) {
            const timerCommands = [];
            for (const command of commandGroup.commands) {
                if (channelToAddTimers !== undefined && channelToAddTimers !== null) {
                    if (!command.responses || command.responses.length === 0) {
                        continue;
                    }
                    timerCommands.push(() => {
                        const responseIndex = randomInt(command.responses.length);
                        const response = command.responses[responseIndex];
                        this.chat(channelToAddTimers, response);
                    });
                }

                for (const name of command.names) {
                    const func = this.getSimpleChatResponseFunc(name, command.responses, command.strict ?? false);
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

    public getSimpleChatResponseFunc(triggerPhrase: string, responses: string[], strictMatch: boolean): (message: IPrivMessageDetail) => void {
        const func = (messageDetail: IPrivMessageDetail) => {
            if (!this.doesTriggerMatch(messageDetail, triggerPhrase, strictMatch)) {
                return;
            }

            const response = responses[randomInt(responses.length)];
            this.chat(messageDetail.respondTo, response);
        }
        return func;
    }

    protected doesTriggerMatch(messageDetails: IPrivMessageDetail, triggerPhrase: string, strictMatch: boolean): boolean {
        const messageTrim = messageDetails.message.trim();
        const triggerTrim = triggerPhrase.trim();
        if (!messageTrim || !triggerTrim) {
            return false;
        }

        const messageArr = messageTrim.split(" ");
        const triggerArr = triggerTrim.split(" ");
        if (messageArr.length < triggerArr.length) {
            return false;
        }
        if (strictMatch && messageArr.length !== triggerArr.length) {
            return false;
        }
        for (let i = 0; i < triggerArr.length; i++) {
            if (messageArr[i] !== triggerArr[i]) {
                return false;
            }
        }

        return true
    }

    public startup(): void {
        this._socket.on("connect", () => this.onConnect());
        this._socket.on("data", (data) => this.onData(data));

        this._socket.connect(this._config.connection.server.port, this._config.connection.server.host);
    }

    protected onConnect(): void {
        console.log("Connected successfully");
        setTimeout(() => {
            this._socket.write(`PASS ${this._config.connection.user.pass}\r\n`);
            this._socket.write(`NICK ${this._config.connection.user.nick}\r\n`);
            this._socket.write(`JOIN ${this._config.connection.server.channel}\r\n`);
        }, 1000);
    }

    protected onData(data: Buffer): void {
        console.log("Received Data");
        const dataStr = data.toString(this._config.encoding);
        const dataStrMessages = dataStr.trimEnd().split("\r\n").map(x => `${x}\r\n`);
        console.log(`  ${ConsoleColors.FgGreen}- ${dataStrMessages.join(`  - `).trimEnd()}${ConsoleColors.Reset}`);

        for (const message of dataStrMessages) {
            const privMessageDetail = this.parsePrivMessage(message);
            if (privMessageDetail) {
                this.handlePrivMessageResponse(privMessageDetail);
                continue;
            }

            const pingMessageDetail = this.parsePingMessage(message);
            if (pingMessageDetail) {
                this.handlePing(pingMessageDetail);
                continue;
            }

            const joinMessageDetail = this.parseJoinMessage(message);
            if (joinMessageDetail) {
                this.handleJoin(joinMessageDetail);
                continue;
            }

            const partMessageDetail = this.parsePartMessage(message);
            if (partMessageDetail) {
                this.handlePart(partMessageDetail);
                continue;
            }
        }

        console.log("");
    }

    protected handleJoin(messageDetail: IJoinMessageDetail): void {
        console.log(`${ConsoleColors.FgRed}${messageDetail.username} joined ${messageDetail.channel}${ConsoleColors.Reset}`);
        this.addUserToChat(messageDetail.username).catch((err) => {
            console.log(`error adding user to chat: ${err}`);
        });
    }

    protected async addUserToChat(username: string): Promise<void> {
        this._usersInChat[username] = UserChatStatus.Connected;
    }

    protected handlePart(messageDetail: IPartMessageDetail): void {
        console.log(`${ConsoleColors.FgRed}${messageDetail.username} departed ${messageDetail.channel}${ConsoleColors.Reset}`);
        this.removeUserFromChat(messageDetail.username).catch((err) => {
            console.log(`error removing user from chat: ${err}`);
        });
    }

    protected async removeUserFromChat(username: string): Promise<void> {
        this._usersInChat[username] = UserChatStatus.Disconnected;
    }

    protected handlePrivMessageResponse(messageDetail: IPrivMessageDetail): void {
        const handlers = this._configuredResponseHandlers.concat(this._hardcodedResponseHandlers);

        for (const handler of handlers) {
            try {
                handler(messageDetail);
            } catch (err) {
                console.log("Error processing response: ")
                console.log(err);
                console.error("Error processing response: ") // TODO: verify this is actually visible
                console.error(err);
            }
        }
    }

    protected handlePing(messageDetail: IPingMessageDetail): void {
        this.sendRaw(`PONG :${messageDetail.hostname}\r\n`);
    }

    public sendRaw(data: string): void {
        if (!data.endsWith("\r\n")) {
            data += "\r\n";
        }
        this._socket.write(data);
        console.log("Sent Data")
        const printStr = data.split("\r\n").join("\r\n  ").trimEnd();
        console.log(`  ${ConsoleColors.FgBlue}${printStr}${ConsoleColors.Reset}\n`);
    }

    protected parsePingMessage(message: string): IPingMessageDetail | undefined {
        const pingPattern = /^PING :(.+)\r?\n?$/;
        const pingRegexArray = pingPattern.exec(message);
        if (pingRegexArray === undefined || pingRegexArray === null) {
            return undefined;
        }

        const pingMessageDetail: IPingMessageDetail = {
            command: "PING",
            hostname: pingRegexArray[1],
        };
        return pingMessageDetail
    }

    protected parsePartMessage(message: string): IPartMessageDetail | undefined {
        const partPattern = /^:(\w+)!(\w+@[\w.]+) PART ([#\w]+)\r?\n?$/;
        const regexArray = partPattern.exec(message);
        if (!regexArray) {
            return undefined;
        }
        const messageDetail: IPartMessageDetail = {
            command: "PART",
            username: regexArray[1],
            hostname: regexArray[2],
            channel: regexArray[3],
        };
        return messageDetail;
    }

    protected parseJoinMessage(message: string): IJoinMessageDetail | undefined {
        const joinPattern = /^:(\w+)!(\w+@[\w.]+) JOIN ([#\w]+)\r?\n?$/;
        const regexArray = joinPattern.exec(message);
        if (!regexArray) {
            return undefined;
        }
        const messageDetail: IJoinMessageDetail = {
            command: "JOIN",
            username: regexArray[1],
            hostname: regexArray[2],
            channel: regexArray[3],
        };
        return messageDetail;
    }

    protected parsePrivMessage(message: string): IPrivMessageDetail | undefined {
        if (this._privMessageDetailCache[message] !== undefined) {
            return this._privMessageDetailCache[message];
        }

        const pattern = /^(@?.* *):(\w+)!(\w+@[\w.]+) PRIVMSG ([#\w]+) :(.+)\r?\n?$/;
        const regexArray = pattern.exec(message);
        if (!regexArray) {
            return undefined;
        }

        const username = regexArray[2];
        const recipient = regexArray[4];
        const respondTo = recipient.startsWith("#") ? recipient : username;

        const messageDetails: IPrivMessageDetail = {
            command: "PRIVMESSAGE",
            tags: regexArray[1],
            username,
            hostname: regexArray[3],
            recipient,
            message: regexArray[5],
            respondTo,
        };

        if (messageDetails === undefined || messageDetails === null) {
            console.log("Message was not parsable!");
        } else {
            this._privMessageDetailCache[message] = messageDetails;
            setTimeout(() => {
                delete this._privMessageDetailCache[message];
            }, 1000)
        }

        return messageDetails
    }

    public chat(recipient: string, message: string): void {
        this.sendRaw(`PRIVMSG ${recipient} :${message}\r\n`);
    }
}