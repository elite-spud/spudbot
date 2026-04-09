import * as fs from "fs";
import { Parser as CsvParser } from "json2csv";
import * as net from "net";
import { IMessageHandler_AcceptsNoInput, IMessageHandler_Simple_Config, IMessageHandlerInput, MessageHandler_InputOptional, MessageHandler_InputRequired, MessageHandler_InputRequired_Config, MessageHandler_Simple } from "./ChatCommand";
import { ConsoleColors } from "./ConsoleColors";
import { Future } from "./Future";
import { PendingTaskGroup } from "./PendingTask";
import { TimerGroup } from "./TimerGroup";
import path = require("path");

export interface IIrcBotConfig {
    connection: IIrcBotConnectionConfig;
    encoding: "utf8" | "ascii";
    auxCommandGroups: IIrcBotSimpleMessageHandlersConfig[];
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

export interface IIrcBotSimpleMessageHandlersConfig {
    timerMinutes?: number;
    timerMinutesOffset?: number;
    random?: boolean;
    messageHandlersConfig: IMessageHandler_Simple_Config[];
}

export interface MessageHandlersFromConfigResult {
    messageHandlers: MessageHandler_Simple[],
    timerGroups: TimerGroup[];
}

export interface IUserDetailCollection<TUserDetail extends UserDetail> {
    [userId: string]: TUserDetail;
}

export interface IUserDetailCollection_Pending<TUserDetail extends UserDetail> {
    [userId: string]: Promise<TUserDetail>;
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

export abstract class IrcBotBase<TUserDetail extends UserDetail, TMessageHandlerInput extends IMessageHandlerInput> {
    private _startupFuture: Future<void> = new Future<void>();
    public get hasStarted(): Promise<void> { return this._startupFuture.asPromise(); };

    public static readonly userDetailEncoding = "utf8";

    protected readonly _config: IIrcBotConfig;

    /** Hardcoded responses are kept separate from those read from a configuration to allow interactive editing of configured commands */
    protected readonly _messageHandlers_inputOptional: MessageHandler_InputOptional<TMessageHandlerInput>[] = [];
    protected readonly _messageHandlers_inputRequired: MessageHandler_InputRequired<TMessageHandlerInput>[] = [];
    protected *_messageHandlers_inputAccepted() {
        for (const handler of this._messageHandlers_inputOptional) {
            yield handler;
        }
        for (const handler of this._messageHandlers_inputRequired) {
            yield handler;
        }
    }
    protected readonly _configuredTimerGroups: TimerGroup[] = [];
    protected readonly _socket: net.Socket;
    protected readonly _privMessageDetailCache: { [key: string]: IPrivMessageDetail } = {};

    private readonly _pendingUserDetailByUserId: IUserDetailCollection_Pending<TUserDetail> = {};
    private readonly _userDetailByUserId: IUserDetailCollection<TUserDetail> = {};
    protected getKnownUserIds(): string[] { return Object.keys(this._userDetailByUserId); }
    private readonly _userIdsInChat: { [userId: string]: UserChatStatus } = {};
    protected getUserIdsInChat(): string[] { return Object.keys(this._userIdsInChat); }

    protected readonly _userDetailsPath: string;
    protected readonly _userDetailsPathCsv: string;
    protected readonly _chatHistoryPath: string = ``; // fs.realpathSync(`${configDir}/users/twitchChatHistory.csv`);

    protected get maxChatMessageLength(): number {
        return this._config.misc.maxChatMessageLength ?? Number.MAX_SAFE_INTEGER
    }

    protected readonly _pendingTasksByUserId = new PendingTaskGroup();

    public constructor(config: IIrcBotConfig) {
        this._config = config;
        this._userDetailsPath = fs.realpathSync(`${this._config.configDir}/users/twitchUserDetails.json`); // TODO: load this path later or ensure the file exists earlier to prevent errors
        this._userDetailsPathCsv = fs.realpathSync(`${this._config.configDir}/users/twitchUserDetails.csv`);

        this._socket = new net.Socket();
        this._socket.setNoDelay();

        const configCommands: MessageHandlersFromConfigResult = this.getSimpleCommandsFromConfig(config.auxCommandGroups);
        for (const command of configCommands.messageHandlers) {
            this._messageHandlers_inputOptional.push(command);
        }
        this._configuredTimerGroups = configCommands.timerGroups;
        this.registerHardcodedMessageHandlers();
        
        this.backupFiles([this._userDetailsPath, this._userDetailsPathCsv]);
        const userDetailJson: string = fs.readFileSync(this._userDetailsPath, { encoding: IrcBotBase.userDetailEncoding });
        const jsonUserCollection = JSON.parse(userDetailJson);
        this._userDetailByUserId = this.createUserCollection(jsonUserCollection); // necessary to instantiate non-primitive fields like Dates
        console.log(`Successfully loaded userDetail from file: ${this._userDetailsPath}`);

        const userTrackingIntervalSeconds = 30;
        setInterval(() => this.trackUsersInChat(userTrackingIntervalSeconds), 1000 * userTrackingIntervalSeconds);
    }

    protected getHardcodedMessageHandlers(): MessageHandler_InputRequired<TMessageHandlerInput>[] {
        return [
            this.getHandler_ChatMessageCount(),
            this.getHandler_Yes(),
            this.getHandler_No(),
        ];
    }

    private registerHardcodedMessageHandlers(): void {
        const handlers = this.getHardcodedMessageHandlers();
        this._messageHandlers_inputRequired.push(...handlers);
    }

    protected async backupFiles(filepaths: string[]): Promise<void> {
        const currentDate = new Date();
        for (const filepath of filepaths) {
            console.log(`Backing up ${filepath}`);
            const parsedPath = path.parse(filepath);
            parsedPath.name += `_${currentDate.getUTCFullYear()}-${currentDate.getUTCMonth() + 1}-${currentDate.getUTCDate()}`;
            parsedPath.base = parsedPath.name + parsedPath.ext;
            const destFilepath = path.format(parsedPath);
            try {
                fs.copyFileSync(filepath, destFilepath);
                console.log(`Successfully backed up file ${filepath} to ${destFilepath}`)
            } catch (err) {
                console.log(`Error backing up file ${filepath}: ${err}`);
                continue;
            }
        }
    }

    protected async trackUsersInChat(secondsToAdd: number): Promise<void> {
        // TODO: track daily / per-stream stats
        const userUpdatePromises: Promise<void>[] = [];
        const userIdsInChat = this.getUserIdsInChat();
        const userDetailIndex = this.getUserDetailsForUserIds(userIdsInChat);
        for (const userIdKey in userDetailIndex) {
            const userDetailPromise = userDetailIndex[userIdKey]!;
            const userUpdatePromise = userDetailPromise.then((userDetail) => {
                userDetail.secondsInChat += secondsToAdd;
                userDetail.lastSeenInChat = new Date();
            }).catch((err) => {
                console.log(`Error adding time to user detail w/ userId: ${userIdKey} ${err}`);
            });
            userUpdatePromises.push(userUpdatePromise);
        }
        
        try {
            // TODO: Add a timeout of some sort (as a promise?)
            await Promise.all(userUpdatePromises);
            // TODO: put a limit on how many user detail files are backed up
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
            const userDetail = userDetails[userId];
            if (userDetail === undefined) {
                continue;
            }
            userDetailMap.set(userId, userDetail);
        }

        const userDetailArray: TUserDetail[] = Array.from(userDetailMap.values());
        userDetailArray.sort((a, b) => b.secondsInChat - a.secondsInChat);

        const parser: CsvParser<TUserDetail> = new CsvParser({ header: true });
        const csv = parser.parse(userDetailArray);

        return csv;
    }

    public async getUserDetailForUserId(userId: string): Promise<TUserDetail> {
        const detailDict = this.getUserDetailsForUserIds([userId]);
        const numKeys = Object.keys(detailDict).length;
        if (numKeys !== 1) {
            throw new Error(`Expected only a single userDetail for userId: ${userId} (found ${numKeys})`);
        }

        return detailDict[userId]!;
    }

    public getUserDetailsForUserIds(userIds: string[]): { [userId: string]: Promise<TUserDetail> } {
        const returnVal: { [userId: string]: Promise<TUserDetail> } = {};

        for (const userId of userIds) {
            const existingUserDetail = this._userDetailByUserId[userId];
            if (existingUserDetail !== undefined) {
                returnVal[userId] = Promise.resolve(existingUserDetail);
                continue;
            }

            const pendingUserDetail = this._pendingUserDetailByUserId[userId];
            if (pendingUserDetail !== undefined) {
                returnVal[userId] = pendingUserDetail;
                continue;
            }

            const newUserDetailPromise = this.createFreshUserDetail(userId);
            this._pendingUserDetailByUserId[userId] = newUserDetailPromise;
            returnVal[userId] = newUserDetailPromise;
            newUserDetailPromise.then((n => {
                this._userDetailByUserId[userId] = n;
                delete this._pendingUserDetailByUserId[userId];
            }));
        }

        return returnVal;
    }

    protected abstract createFreshUserDetail(userId: string): Promise<TUserDetail>;
    
    protected abstract createUserCollection(collection: IUserDetailCollection<TUserDetail>): IUserDetailCollection<TUserDetail>;

    protected getChatCommand(commandConfig: IMessageHandler_Simple_Config): MessageHandler_Simple | undefined {
        if (!commandConfig.name || commandConfig.responses === undefined || commandConfig.responses.length === 0) {
            return undefined
        }
        return new MessageHandler_Simple(commandConfig);
    }

    protected getTimerGroup(commands: IMessageHandler_AcceptsNoInput[], intervalMinutes: number, startDelayMinutes?: number, randomizeCommands?: boolean): TimerGroup {
        return new TimerGroup(commands, intervalMinutes, startDelayMinutes, randomizeCommands);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    protected getSimpleCommandsFromConfig(commandGroups: IIrcBotSimpleMessageHandlersConfig[]): MessageHandlersFromConfigResult {
        const chatCommands: MessageHandler_Simple[] = [];
        const timerGroups: TimerGroup[] = [];
        
        for (const commandGroup of commandGroups) {
            const simpleCommands: MessageHandler_Simple[] = [];
            for (const commandConfig of commandGroup.messageHandlersConfig) {
                const command = this.getChatCommand(commandConfig);
                if (command === undefined) {
                    continue;
                }
                simpleCommands.push(command);
            }

            if (commandGroup.timerMinutes !== undefined) {
                const timerGroup = this.getTimerGroup(simpleCommands, commandGroup.timerMinutes, commandGroup.timerMinutesOffset, commandGroup.random);
                timerGroups.push(timerGroup);
            }
            chatCommands.push(...simpleCommands);
        }

        return { messageHandlers: chatCommands, timerGroups };
    }

    public async startup(): Promise<void> {
        try {
            await this._startup();
            this._startupFuture.resolve();
        } catch (err) {
            this._startupFuture.reject(err);
        }
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
        console.log(`CAUGHT SOCKET ERROR:`);
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
        const userIdsByUsername = await this.getUserIdsForUsernames([username]);
        const numKeys = Object.keys(userIdsByUsername).length;
        if (numKeys !== 1) {
            throw new Error(`Expected only a single userDetail for username: ${username} (found ${numKeys})`)
        }

        return userIdsByUsername[username]!;
    }

    protected async getUserIdsForUsernames(usernames: string[]): Promise<{ [username: string]: string | undefined }> {
        const userIdsByUsername: { [username: string]: string | undefined} = {};
        for (const username of usernames) {
            userIdsByUsername[username] = username;
        }
        return userIdsByUsername;
    }

    protected async handleJoinMessage(messageDetail: IJoinMessageDetail): Promise<void> {
        console.log(  `${ConsoleColors.FgRed}${messageDetail.username} joined ${messageDetail.channel}${ConsoleColors.Reset}`);
        try {
            const userId = await this.getUserIdForUsername(messageDetail.username);
            this._userIdsInChat[userId] = UserChatStatus.Connected;
            
            const userDetail = await this.getUserDetailForUserId(userId);
            if (userDetail.username !== messageDetail.username) {
                this.updateUsername(userDetail, messageDetail.username);
            }
        } catch (err) {
            console.log(`error adding user to chat: ${err}`);
        }
    }

    protected updateUsername(userDetail: TUserDetail, newUsername: string): void {
        if (userDetail.oldUsernames === undefined) {
            userDetail.oldUsernames = [];
        }
        userDetail.oldUsernames.push({ username: userDetail.username, lastSeenInChat: userDetail.lastSeenInChat ?? new Date() });
        userDetail.username = newUsername;
    }

    /** Part messages are sent when a user departs a chatroom */
    protected async handlePartMessage(messageDetail: IPartMessageDetail): Promise<void> {
        console.log(  `${ConsoleColors.FgRed}${messageDetail.username} departed ${messageDetail.channel}${ConsoleColors.Reset}`);
        try {
            const userId = await this.getUserIdForUsername(messageDetail.username);
            delete this._userIdsInChat[userId];
        } catch (err) {
            console.log(`error removing user from chat: ${err}`);
        }
    }

    protected getHandler_ChatMessageCount(): MessageHandler_InputRequired {
        const handleFunc = async (input: IMessageHandlerInput) => {
            try {
                const userDetail = await this.getUserDetailForUserId(input.userId);
                if (!userDetail.numChatMessages) {
                    userDetail.numChatMessages = 0;
                }
                
                userDetail.numChatMessages++;
                userDetail.lastChatted = new Date();
            } catch (err) {
                console.log(`Error updating chat message count for user: ${input.userId}`);
                console.log(err);
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput> = {
            handlerId: "chatMessageCount",
            triggerPhrases: undefined,
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected abstract createMessageInput(detail: IPrivMessageDetail): Promise<TMessageHandlerInput>;

    protected async handlePrivMessageResponse(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageInput = await this.createMessageInput(messageDetail);
        const handlers = this._messageHandlers_inputAccepted();
        const timestamp = new Date();

        const promises = []
        for (const handler of handlers) {
            const promise = handler.handleMessageWithInput(messageInput, timestamp, false).catch((err) => {
                console.log("Error processing privMessage response: ");
                console.log(err);
                console.error("Error processing privMessage response: "); // TODO: actually use this output stream
                console.error(err);
            });
            promises.push(promise);
        }

        await Promise.all(promises);
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
            hostname: pingRegexArray[1]!,
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
            username: regexArray[1]!,
            hostname: regexArray[2]!,
            channel: regexArray[3]!,
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
            username: regexArray[1]!,
            hostname: regexArray[2]!,
            channel: regexArray[3]!,
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

        const username = regexArray[2]!;
        const recipient = regexArray[4]!;
        const respondTo = recipient.startsWith("#") ? recipient : username;

        const messageDetails: IPrivMessageDetail = {
            command: "PRIVMESSAGE",
            tags: regexArray[1],
            username,
            hostname: regexArray[3]!,
            recipient,
            message: regexArray[5]!,
            respondTo,
        };

        if (messageDetails === undefined || messageDetails === null) {
            console.log("Message was not parsable!");
        } else {
            this._privMessageDetailCache[message] = messageDetails;
            setTimeout(() => {
                delete this._privMessageDetailCache[message];
            }, 2000);
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

    protected getHandler_Yes(): MessageHandler_InputRequired {
        const handleFunc = async (input: IMessageHandlerInput) => {
            await this._pendingTasksByUserId.complete(input.userId);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput> = {
            handlerId: "!yes",
            triggerPhrases: ["!yes"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_No(): MessageHandler_InputRequired {
        const handleFunc = async (input: IMessageHandlerInput) => {
            await this._pendingTasksByUserId.cancel(input.userId);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput> = {
            handlerId: "!no",
            triggerPhrases: ["!no"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }
}