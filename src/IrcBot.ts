import { randomInt } from "crypto";
import * as fs from "fs";
import { Parser as CsvParser } from "json2csv";
import * as net from "net";
import { ConsoleColors } from "./ConsoleColors";
import { TimerGroup } from "./TimerGroup";

export interface IIrcBotConfig {
    connection: IIrcBotConnectionConfig;
    encoding: "utf8" | "ascii";
    auxCommandGroups: IIrcBotAuxCommandGroupConfig[];
    configDir: string;
    misc: IIrcBotMiscConfig;
}

export interface IIrcBotMiscConfig {
    maxChatMessageLength?: number;
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

export interface CommandsFromConfigResult {
    chatResponses: ((messageDetail: IPrivMessageDetail) => Promise<void>)[];
    timerGroups: TimerGroup[];
}

export interface IUserDetailCollection<TUserDetail extends UserDetail> {
    [userId: string]: TUserDetail;
}

export interface IUserDetail {
    username: string;
    secondsInChat: number;
    numChatMessages: number;
    lastSeenInChat?: Date;
    lastChatted?: Date;
    oldUsernames?: { username: string, lastSeenInChat: Date }[];
}

export class UserDetail implements IUserDetail {
    public username: string;
    public secondsInChat: number;
    public numChatMessages: number;
    public lastSeenInChat?: Date;
    public lastChatted?: Date;
    public oldUsernames?: { username: string, lastSeenInChat: Date }[];

    public constructor(detail: IUserDetail) {
        this.username = detail.username;
        this.secondsInChat = detail.secondsInChat;
        this.numChatMessages = detail.numChatMessages;
        this.lastSeenInChat = detail.lastSeenInChat === undefined ? undefined : new Date(detail.lastSeenInChat);
        this.lastChatted = detail.lastChatted === undefined ? undefined : new Date(detail.lastChatted);
        this.oldUsernames = detail.oldUsernames === undefined
            ? undefined
            : detail.oldUsernames.map(n => {
                return { username: n.username, lastSeenInChat: new Date(n.lastSeenInChat) }
            });
    }
}

export interface IIrcBotAuxCommandConfig {
    name: string;
    aliases?: string[];
    /** Matches names exactly (ignoring whitespace) */
    strict?: boolean; // TODO: allow specifying strict match for each name/alias, not all.
    /** Date string */
    expiresAt?: string;
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

/**
 * Represents a generic message handler that triggers from a set of specific command phrases at the start of a message
 */
export interface NewCommandArgs {
    messageHandler: (messageDetail: IPrivMessageDetail) => Promise<void>,
    triggerPhrases: string[],
    strictMatch: boolean,
    /**
     * Globally unique identifier for this command
     */
    commandId: string,
    globalTimeoutSeconds: number,
    userTimeoutSeconds: number
}

export enum UserChatStatus {
    Disconnected = 0,
    BeingAdded = 1,
    Connected = 2,
}

export abstract class IrcBotBase<TUserDetail extends UserDetail> {
    private _startupPromise: Promise<void>;
    public get hasStarted(): Promise<void> { return this._startupPromise; };

    public static readonly userDetailEncoding = "utf8";

    protected readonly _config: IIrcBotConfig;

    /** Hardcoded responses are kept separate from those read from a configuration to allow interactive editing of configured commands */
    protected readonly _hardcodedPrivMessageResponseHandlers: ((message: IPrivMessageDetail) => Promise<void>)[] = [];
    protected readonly _configuredPrivMessageResponseHandlers: ((message: IPrivMessageDetail) => Promise<void>)[] = [];
    protected readonly _configuredTimerGroups: TimerGroup[] = [];
    protected readonly _socket: net.Socket;
    protected readonly _privMessageDetailCache: { [key: string]: IPrivMessageDetail } = {};

    // TODO: Implement this
    protected readonly _userTimeoutByCommandUsername: { [key: string]: number } = {};
    protected readonly _globalTimeoutByCommand: { [key: string]: number } = {};

    protected readonly _pendingUserDetailByUsername: { [username: string]: Promise<TUserDetail> } = {};
    /** UserId is a unique identifier that identifies a single user across multiple usernames */
    protected readonly _userDetailByUserId: IUserDetailCollection<TUserDetail>;
    protected readonly _usernamesInChat: { [key: string]: UserChatStatus } = {};

    protected readonly _userDetailsPath: string;
    protected readonly _userDetailsPathCsv: string;
    protected readonly _chatHistoryPath: string = ``; // fs.realpathSync(`${configDir}/users/twitchChatHistory.csv`);

    protected get maxChatMessageLength(): number {
        return this._config.misc.maxChatMessageLength ?? Number.MAX_SAFE_INTEGER
    }

    public constructor(config: IIrcBotConfig) {
        this._config = config;
        this._userDetailsPath = fs.realpathSync(`${this._config.configDir}/users/twitchUserDetails.json`); // TODO: load this path later or ensure the file exists earlier to prevent errors
        this._userDetailsPathCsv = fs.realpathSync(`${this._config.configDir}/users/twitchUserDetails.csv`);

        this._socket = new net.Socket();
        this._socket.setNoDelay();

        const configCommands: CommandsFromConfigResult = this.getCommandsFromConfig(config.auxCommandGroups, config.connection.server.channel);
        this._configuredPrivMessageResponseHandlers = configCommands.chatResponses;
        this._configuredTimerGroups = configCommands.timerGroups;

        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleChatMessageCount(detail));
        
        const userDetailJson: string = fs.readFileSync(this._userDetailsPath, { encoding: IrcBotBase.userDetailEncoding });
        const jsonUserCollection = JSON.parse(userDetailJson);
        this._userDetailByUserId = this.createUserCollection(jsonUserCollection); // necessary to instantiate non-primitive fields like Dates
        console.log(`Successfully loaded userDetail from file: ${this._userDetailsPath}`);

        const userTrackingIntervalSeconds = 30;
        setInterval(() => this.trackUsersInChat(userTrackingIntervalSeconds), 1000 * userTrackingIntervalSeconds);
    }

    protected async trackUsersInChat(secondsToAdd: number): Promise<void> {
        // TODO: track daily / per-stream stats
        const userUpdatePromises: Promise<void>[] = [];
        for (const username of Object.keys(this._usernamesInChat)) {
            const userUpdatedPromise = this.getUserDetailWithCache(username).then((userDetail) => {
                userDetail.secondsInChat += secondsToAdd;
                userDetail.lastSeenInChat = new Date();
            }).catch((err) => {
                console.log(`Error adding time to user detail with username ${username}: ${err}`);
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
            const tempFilePath = `${this._userDetailsPath}_temp`;

            const json = JSON.stringify(this._userDetailByUserId);
            fs.writeFileSync(tempFilePath, json);
            fs.renameSync(tempFilePath, this._userDetailsPath);
            console.log(`Successfully wrote userDetail to file: ${this._userDetailsPath}`);

            const csv = this.getCsvUserDetail(this._userDetailByUserId);
            fs.writeFileSync(this._userDetailsPathCsv, csv);
            // console.log(`Successfully wrote userDetail to file: ${this.userDetailsPathCsv}`);

        } catch (err) {
            console.log(`Error writing userDetail status to file: ${err}`);
        }
    }

    protected getCsvUserDetail(userDetails: IUserDetailCollection<TUserDetail>): string {
        const userDetailMap = new Map<string, TUserDetail>();
        for (const userId in userDetails) {
            userDetailMap.set(userId, userDetails[userId]);
        }

        const userDetailArray: TUserDetail[] = Array.from(userDetailMap.values());
        userDetailArray.sort((a, b) => b.secondsInChat - a.secondsInChat);

        const parser: CsvParser<TUserDetail> = new CsvParser({ header: true });
        const csv = parser.parse(userDetailArray);

        return csv;
    }

    protected async getUserDetailWithCache(username: string): Promise<TUserDetail> {
        if (!!this._pendingUserDetailByUsername[username]) {
            return this._pendingUserDetailByUsername[username];
        }

        // We need the userId here to determine which stored userDetail belongs to the given username (the user may have changed their username)
        const promise = this.getUserIdForUsername(username).then((userId) => {
            if (this._userDetailByUserId[userId]) {
                return this._userDetailByUserId[userId];
            }

            const userDetail = this.createFreshUserDetail(username, userId);
            this._userDetailByUserId[userId] = userDetail;

            delete this._pendingUserDetailByUsername[userId];
            return userDetail;
        });

        this._pendingUserDetailByUsername[username] = promise;
        return promise;
    }

    protected abstract createFreshUserDetail(username: string, userId: string): TUserDetail;
    
    protected abstract createUserCollection(collection: IUserDetailCollection<TUserDetail>): IUserDetailCollection<TUserDetail>;

    protected async callCommandFunctionFromConfig(command: IIrcBotAuxCommandConfig, channel: string): Promise<boolean> {
        if (command.expiresAt !== undefined) {
            try {
                const expireTime = new Date(command.expiresAt).getTime();
                if (expireTime < Date.now()) {
                    return false;
                }
            } catch (err) {
                console.log(`Failed to compare command expiration time: ${err.message}`);
            }
        }
        const responseIndex = randomInt(command.responses.length);
        const response = command.responses[responseIndex];
        this.chat(channel, response, true);
        return true;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    protected getCommandsFromConfig(commandGroups: IIrcBotAuxCommandGroupConfig[], channelToAddTimers: string | undefined): CommandsFromConfigResult {
        const chatResponses: ((messageDetail: IPrivMessageDetail) => Promise<void>)[] = [];
        const timerGroups: TimerGroup[] = [];
        
        for (const commandGroup of commandGroups) {
            const timerCommands: {(): Promise<boolean>}[] = [];
            for (const command of commandGroup.commands) {
                if (channelToAddTimers !== undefined && channelToAddTimers !== null) {
                    if (!command.responses || command.responses.length === 0) {
                        continue;
                    }
                    const func = () => this.callCommandFunctionFromConfig(command, channelToAddTimers)
                        .catch((err) => {
                            this.onError(err);
                            return false;
                        });
                    timerCommands.push(func);
                }

                if (!command.name) {
                    continue;
                }
                const commandNames = Array.isArray(command.aliases)
                    ? [command.name].concat(command.aliases)
                    : [command.name];
                const func = this.getSimpleCommandFunc(commandNames, command.responses, command.strict ?? false, command.name, command.globalTimeoutSeconds ?? 0, command.userTimeoutSeconds ?? 30);
                chatResponses.push(func);
            }

            if (commandGroup.timerMinutes !== null && commandGroup.timerMinutes !== undefined) {
                const timerGroup = new TimerGroup(timerCommands, commandGroup.timerMinutes, commandGroup.timerMinutesOffset, commandGroup.random);
                timerGroups.push(timerGroup);
            }
        }

        return { chatResponses, timerGroups };
    }

    /**
     * Creates a basic response function that responds to a matching message with only simple text strings
     * @param triggerPhrases 
     * @param responses 
     * @param strictMatch 
     * @param commandKey 
     * @param globalTimeoutSeconds 
     * @param userTimeoutSeconds 
     * @returns 
     */
    public getSimpleCommandFunc(triggerPhrases: string[], responses: string[], strictMatch: boolean, commandId: string, globalTimeoutSeconds: number, userTimeoutSeconds: number): (message: IPrivMessageDetail) => Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const response = responses[randomInt(responses.length)];
            this.chat(messageDetail.respondTo, response, true);
        }
        return this.getCommandFunc({
            messageHandler: subFunc,
            triggerPhrases,
            strictMatch,
            commandId,
            globalTimeoutSeconds,
            userTimeoutSeconds,
        });
    }

    /**
     * Creates a handling function triggered by specific keyphrases that wraps an arbitrary handle function
     * @param args 
     * @returns 
     */
    public getCommandFunc(args: NewCommandArgs): (messageDetail: IPrivMessageDetail) => Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const hasMatch = args.triggerPhrases.some((triggerPhrase) => {
                return this.doesTriggerMatch(messageDetail, triggerPhrase, args.strictMatch);
            });
            if (!hasMatch) {
                return;
            }

            if (!this.shouldIgnoreTimeoutRestrictions(messageDetail)) {
                if (this.isCommandTimedOut(args.commandId, messageDetail.username)) {
                    return;
                }
            }

            await args.messageHandler(messageDetail);

            this.addCommandTimeoutDelays(args.commandId, args.globalTimeoutSeconds, { userTimeoutSeconds: args.userTimeoutSeconds, username: messageDetail.username });
        }
        return messageHandler;
    }

    protected abstract shouldIgnoreTimeoutRestrictions(messageDetail: IPrivMessageDetail): boolean;

    protected addCommandTimeoutDelays(commandId: string, globalTimeoutSeconds: number, userTimeout?: { userTimeoutSeconds: number, username: string }): void {
        if (userTimeout && userTimeout.userTimeoutSeconds > 0) {
            const userCantUseCommandForMillis = userTimeout.userTimeoutSeconds * 1000;
            const canUseCommandAgainAt = Date.now() + userCantUseCommandForMillis;
            const userTimeoutCompositeKey = `${commandId}_${userTimeout.username}`;
            this._userTimeoutByCommandUsername[userTimeoutCompositeKey] = canUseCommandAgainAt;
            setTimeout(() => { delete this._userTimeoutByCommandUsername[userTimeoutCompositeKey]; }, userCantUseCommandForMillis);
        }

        if (globalTimeoutSeconds > 0) {
            const noneCanUseCommandForMillis = globalTimeoutSeconds * 1000;
            const canUseCommandAgainAt = Date.now() + noneCanUseCommandForMillis;
            this._globalTimeoutByCommand[commandId] = canUseCommandAgainAt;
            setTimeout(() => { delete this._globalTimeoutByCommand[commandId]; }, noneCanUseCommandForMillis);
        }
    }

    protected isCommandTimedOut(commandId: string, username?: string): boolean {
        const globalTimeoutAt = this._globalTimeoutByCommand[commandId] ?? 0;
        if (globalTimeoutAt > Date.now()) {
            return true;
        }

        if (username) {
            const userTimeoutCompositeKey = `${commandId}_${username}`;
            const userTimeoutAt = this._userTimeoutByCommandUsername[userTimeoutCompositeKey] ?? 0;
            if (userTimeoutAt > Date.now()) {
                return true;
            }
        }

        return false;
    }

    protected doesTriggerMatch(messageDetail: IPrivMessageDetail, triggerPhrase: string, strictMatch: boolean): boolean {
        const messageTrim = messageDetail.message.trim();
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

    public async startup(): Promise<void> {
        this._startupPromise = new Promise<void>((resolve, reject) => {
            this._startup().then(() => {
                resolve();
            }).catch((err) => {
                reject(err);
            });
        });

        return this._startupPromise;
    }

    public async _startup(): Promise<void> {
        this._socket.on("error", (err) => this.onError(err));
        this._socket.on("data", (data) => this.onData(data));

        const connectPromise = new Promise<void>((resolve) => {
            this._socket.connect(this._config.connection.server.port, this._config.connection.server.host,
                () => {
                    console.log("Connected successfully");
                    this.sendRaw(`PASS ${this._config.connection.user.pass}\r\n`);
                    this.sendRaw(`NICK ${this._config.connection.user.nick}\r\n`);
                    this.sendRaw(`JOIN ${this._config.connection.server.channel}\r\n`);
                    resolve();
                }); // TODO: connect using the SSL URL (IRC or websocket?) https://dev.twitch.tv/docs/irc#twitch-specific-irc-messages
        });

        await connectPromise;
        this._configuredTimerGroups.forEach(timer => timer.startTimer());
    }

    protected onError(err: Error): void {
        console.log(`CAUGHT SOCKET ERROR`);
        console.log(err.stack);
    }

    protected onData(data: Buffer): void {
        console.log("Received IRC Data");
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
                this.handleJoinMessage(joinMessageDetail);
                continue;
            }

            const partMessageDetail = this.parsePartMessage(message);
            if (partMessageDetail) {
                this.handlePartMessage(partMessageDetail);
                continue;
            }
        }

        console.log("");
    }

    protected async getUserIdForUsername(username: string): Promise<string> {
        return username;
    }

    protected async handleJoinMessage(messageDetail: IJoinMessageDetail): Promise<void> {
        console.log(  `${ConsoleColors.FgRed}${messageDetail.username} joined ${messageDetail.channel}${ConsoleColors.Reset}`);
        try {
            this._usernamesInChat[messageDetail.username] = UserChatStatus.Connected;
        } catch (err) {
            console.log(`error adding user to chat: ${err}`);
        }
    }

    /** Part messages are sent when a user departs a chatroom */
    protected async handlePartMessage(messageDetail: IPartMessageDetail): Promise<void> {
        console.log(  `${ConsoleColors.FgRed}${messageDetail.username} departed ${messageDetail.channel}${ConsoleColors.Reset}`);
        try {
            delete this._usernamesInChat[messageDetail.username];
        } catch (err) {
            console.log(`error removing user from chat: ${err}`);
        }
    }

    protected async handleChatMessageCount(messageDetail: IPrivMessageDetail): Promise<void> {
        const userDetail = await this.getUserDetailWithCache(messageDetail.username);
        if (!userDetail.numChatMessages) {
            userDetail.numChatMessages = 0;
        }
        
        userDetail.numChatMessages++;
        userDetail.lastChatted = new Date();
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

    public sendRaw(data: string, enableLogging: boolean = true): void {
        if (!data.endsWith("\r\n")) {
            data += "\r\n";
        }
        this._socket.write(data);
        if (enableLogging) {
            console.log("Sent IRC Data");
        }
        const printStr = data.split("\r\n").join("\r\n  ").trimEnd();
        if (enableLogging) {
            console.log(`  ${ConsoleColors.FgCyan}${printStr}${ConsoleColors.Reset}\n`);
        }
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
            }, 2000)
        }

        return messageDetails
    }

    public chat(recipient: string, message: string, ignoreCharacterLimit: boolean = false): void {
        // TODO: Wait on join here?

        let actualMessage = message;
        if (actualMessage.length > this.maxChatMessageLength) {
            if (ignoreCharacterLimit) {
                while (actualMessage.length > this.maxChatMessageLength) {
                    const head = actualMessage.substring(0, this.maxChatMessageLength);
                    this.chat(recipient, head);
                    actualMessage = actualMessage.substring(this.maxChatMessageLength);
                }
                this.chat(recipient, actualMessage);
                return;
            }

            actualMessage = "<Message was too long. Please file a bug report with the owner :)>";
            console.log(`Message too long: ${message}`);
        }

        this.sendRaw(`PRIVMSG ${recipient} :${actualMessage}\r\n`);
    }
}