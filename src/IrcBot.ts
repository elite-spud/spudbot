import { randomInt } from "crypto";
import * as fs from "fs";
import * as net from "net";
import { ConsoleColors } from "./ConsoleColors";
import { TimerGroup } from "./TimerGroup";

export interface IIrcBotConfig {
    connection: IIrcBotConnectionConfig,
    encoding: "utf8" | "ascii" | string,
    auxCommandGroups: IIrcBotAuxCommandGroupConfig[],
    userDetailFilePath: string,
    chatHistoryFilePath: string,
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

export interface IUserDetailCollection<TUserDetail extends IUserDetail> {
    [key: string]: TUserDetail;
}

export interface IUserDetail {
    username: string;
    secondsInChat: number;
    numChatMessages: number;
}

export interface IIrcBotAuxCommandConfig {
    name: string;
    aliases?: string[];
    /** Matches names exactly (ignoring whitespace) */
    strict?: boolean; // TODO: allow specifying strict match for each name/alias, not all.
    responses: string[];
    /** Delay until this command can be triggered again by a particular user (defaults to 30 seconds) */
    userTimeoutSeconds?: number;
    /** Delay until this command can be triggered again by any user (defaults to 0 seconds) */
    globalTimeoutSeconds?: number;
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

export abstract class IrcBotBase<TUserDetail extends IUserDetail> {
    public static readonly userDetailEncoding = "utf8";

    /** Hardcoded responses are kept separate from those read from a configuration to allow interactive editing of configured commands */
    protected readonly _hardcodedPrivMessageResponseHandlers: ((message: IPrivMessageDetail) => Promise<void>)[] = [];
    protected readonly _configuredPrivMessageResponseHandlers: ((message: IPrivMessageDetail) => Promise<void>)[] = [];
    protected readonly _configuredTimerGroups: TimerGroup[] = [];
    protected readonly _socket: net.Socket;
    protected readonly _privMessageDetailCache: { [key: string]: IPrivMessageDetail } = {};

    // TODO: Implement this
    protected readonly _userTimeoutByCommandUserId: { [key: string]: number } = {};
    protected readonly _globalTimeoutByCommand: { [key: string]: number } = {};

    protected readonly _pendingUserDetailByUserId: { [key: string]: Promise<TUserDetail> } = {};
    protected readonly _userDetailByUserId: IUserDetailCollection<TUserDetail>;
    protected readonly _userIdsInChat: { [key: string]: UserChatStatus } = {};

    public constructor(protected readonly _config: IIrcBotConfig) {
        this._socket = new net.Socket();
        this._socket.setNoDelay();

        const configCommands = this.getCommandsFromConfig(_config.auxCommandGroups, _config.connection.server.channel);
        this._configuredPrivMessageResponseHandlers = configCommands.chatResponses;
        this._configuredTimerGroups = configCommands.timerGroups;
        this._configuredTimerGroups.forEach(timer => timer.startTimer());

        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleChatMessageCount(detail));
        
        const userDetailJson: string = fs.readFileSync(_config.userDetailFilePath, { encoding: IrcBotBase.userDetailEncoding });        
        this._userDetailByUserId = JSON.parse(userDetailJson); // TODO: Add error checking of some sort
        console.log(`Successfully loaded userDetail from file: ${_config.userDetailFilePath}`);
        console.log(this._userDetailByUserId);

        const userTrackingIntervalSeconds = 30;
        setInterval(() => this.trackUsersInChat(userTrackingIntervalSeconds), 1000 * userTrackingIntervalSeconds);
    }

    protected async trackUsersInChat(secondsToAdd: number): Promise<void> {
        const userUpdatePromises: Promise<void>[] = [];
        for (const userId of Object.keys(this._userIdsInChat)) {
            const userUpdatedPromise = this.getUserDetailWithCache(userId).then((userDetail) => {
                this.addTimeSpentInChatToUser(userDetail, secondsToAdd);
            }).catch((err) => {
                console.log(`Error adding time to user detail with userId ${userId}: ${err}`);
            });
            userUpdatePromises.push(userUpdatedPromise);
        }
        
        try {
            // TODO: Add a timeout of some sort (as a promise?)
            await Promise.all(userUpdatePromises);
            // TODO: put a limit on how many user detail files are backed up
            // const dateNow = new Date();
            // const dateSuffix = dateNow.toISOString().split(":").join("_").split(".").join("_");
            // fs.renameSync(this._config.userDetailFilePath, `${this._config.userDetailFilePath}_${dateSuffix}`);
            const tempFilePath = `${this._config.userDetailFilePath}_temp`;
            fs.writeFileSync(tempFilePath, JSON.stringify(this._userDetailByUserId));
            fs.renameSync(tempFilePath, this._config.userDetailFilePath);
            console.log(`Successfully wrote userDetail to file: ${this._config.userDetailFilePath}`);
        } catch (err) {
            console.log(`Error writing userDetail status to file: ${err}`);
        }
    }

    protected async getUserDetailWithCache(userId: string): Promise<TUserDetail> {
        if (this._userDetailByUserId[userId]) {
            return this._userDetailByUserId[userId];
        }

        if (this._pendingUserDetailByUserId[userId]) {
            return this._pendingUserDetailByUserId[userId];
        }

        const promise = this.createUserDetail(userId).then((userDetail) => {
            this._userDetailByUserId[userId] = userDetail;
            delete this._pendingUserDetailByUserId[userId];
            return userDetail;
        });
        this._pendingUserDetailByUserId[userId] = promise;
        return promise;
    }

    protected addTimeSpentInChatToUser(userDetail: TUserDetail, secondsToAdd: number): void {
        userDetail.secondsInChat += secondsToAdd;
    }

    protected abstract async createUserDetail(userId: string): Promise<TUserDetail>;

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    protected getCommandsFromConfig(commandGroups: IIrcBotAuxCommandGroupConfig[], channelToAddTimers: string | undefined) {
        const chatResponses: ((messageDetail: IPrivMessageDetail) => Promise<void>)[] = [];
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

                if (!command.name) {
                    continue;
                }
                const commandNames = Array.isArray(command.aliases)
                    ? [command.name].concat(command.aliases)
                    : [command.name];
                const func = this.getSimpleChatResponseFunc(commandNames, command.responses, command.strict ?? false, command.name, command.globalTimeoutSeconds ?? 0, command.userTimeoutSeconds ?? 30);
                chatResponses.push(func);
            }

            if (commandGroup.timerMinutes !== null && commandGroup.timerMinutes !== undefined) {
                const timerGroup = new TimerGroup(timerCommands, commandGroup.timerMinutes, commandGroup.timerMinutesOffset, commandGroup.random);
                timerGroups.push(timerGroup);
            }
        }

        return { chatResponses, timerGroups };
    }

    public getSimpleChatResponseFunc(triggerPhrases: string[], responses: string[], strictMatch: boolean, commandKey: string, globalTimeoutSeconds: number, userTimeoutSeconds: number): (message: IPrivMessageDetail) => Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const response = responses[randomInt(responses.length)];
            this.chat(messageDetail.respondTo, response);            
        }
        return this.getChatResponseFunc({
            subFunc,
            triggerPhrases,
            strictMatch,
            commandKey,
            globalTimeoutSeconds,
            userTimeoutSeconds,
        });
    }

    public getChatResponseFunc(args: { subFunc: (messageDetail: IPrivMessageDetail) => Promise<void>, triggerPhrases: string[], strictMatch: boolean, commandKey: string, globalTimeoutSeconds: number, userTimeoutSeconds: number }): (messageDetail: IPrivMessageDetail) => Promise<void> {
        const wrappedFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            for (const triggerPhrase of args.triggerPhrases) {
                if (!this.doesTriggerMatch(messageDetail, triggerPhrase, args.strictMatch)) {
                    return;
                }
            }

            const userId = await this.getUserIdForUsername(messageDetail.username);
            if (!this.shouldIgnoreTimeoutRestrictions(messageDetail)) {
                if (this.isCommandTimedOut(args.commandKey, userId)) {
                    return;
                }
            }

            await args.subFunc(messageDetail);

            this.addCommandTimeoutDelays(args.commandKey, args.globalTimeoutSeconds, { userTimeoutSeconds: args.userTimeoutSeconds, userId });
        }
        return wrappedFunc;
    }

    protected abstract shouldIgnoreTimeoutRestrictions(messageDetail: IPrivMessageDetail): boolean;

    protected addCommandTimeoutDelays(commandKey: string, globalTimeoutSeconds: number, userTimeout?: { userTimeoutSeconds: number, userId: string }): void {
        if (userTimeout && userTimeout.userTimeoutSeconds > 0) {
            const userCantUseCommandForMillis = userTimeout.userTimeoutSeconds * 1000;
            const canUseCommandAgainAt = Date.now() + userCantUseCommandForMillis;
            const userTimeoutCompositeKey = `${commandKey}_${userTimeout.userId}`;
            this._userTimeoutByCommandUserId[userTimeoutCompositeKey] = canUseCommandAgainAt;
            setTimeout(() => { delete this._userTimeoutByCommandUserId[userTimeoutCompositeKey]; }, userCantUseCommandForMillis);
        }

        if (globalTimeoutSeconds > 0) {
            const noneCanUseCommandForMillis = globalTimeoutSeconds * 1000;
            const canUseCommandAgainAt = Date.now() + noneCanUseCommandForMillis;
            this._globalTimeoutByCommand[commandKey] = canUseCommandAgainAt;
            setTimeout(() => { delete this._globalTimeoutByCommand[commandKey]; }, noneCanUseCommandForMillis);
        }
    }

    protected isCommandTimedOut(commandKey: string, userId?: string): boolean {
        const globalTimeoutAt = this._globalTimeoutByCommand[commandKey] ?? 0;
        if (globalTimeoutAt > Date.now()) {
            return true;
        }

        if (userId) {
            const userTimeoutCompositeKey = `${commandKey}_${userId}`;
            const userTimeoutAt = this._userTimeoutByCommandUserId[userTimeoutCompositeKey] ?? 0;
            if (userTimeoutAt > Date.now()) {
                return true;
            }
        }

        return false;
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

    protected async getUserIdForUsername(username: string): Promise<string> {
        return username;
    }

    protected async handleJoin(messageDetail: IJoinMessageDetail): Promise<void> {
        console.log(  `${ConsoleColors.FgRed}${messageDetail.username} joined ${messageDetail.channel}${ConsoleColors.Reset}`);
        try {
            const userId = await this.getUserIdForUsername(messageDetail.username);
            this._userIdsInChat[userId] = UserChatStatus.Connected;
        } catch (err) {
            console.log(`error adding user to chat: ${err}`);
        }
    }

    protected async handlePart(messageDetail: IPartMessageDetail): Promise<void> {
        console.log(  `${ConsoleColors.FgRed}${messageDetail.username} departed ${messageDetail.channel}${ConsoleColors.Reset}`);
        try {
            const userId = await this.getUserIdForUsername(messageDetail.username);
            delete this._userIdsInChat[userId];
        } catch (err) {
            console.log(`error removing user from chat: ${err}`);
        }
    }

    protected async handleChatMessageCount(messageDetail: IPrivMessageDetail): Promise<void> {
        const userId = await this.getUserIdForUsername(messageDetail.username);
        const userDetail = await this.getUserDetailWithCache(userId);
        if (!userDetail.numChatMessages) {
            userDetail.numChatMessages = 0;
        }
        userDetail.numChatMessages++;
    }

    protected handlePrivMessageResponse(messageDetail: IPrivMessageDetail): void {
        const handlers = this._configuredPrivMessageResponseHandlers.concat(this._hardcodedPrivMessageResponseHandlers);

        for (const handler of handlers) {
            handler(messageDetail).catch((err) => {
                console.log("Error processing privMessage response: ");
                console.log(err);
                console.error("Error processing privMessage response: "); // TODO: actually use this output stream
                console.error(err);
            });
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