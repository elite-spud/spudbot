import { randomInt } from "crypto";
import { IPrivMessageDetail } from "./IrcBot";

export enum HandleMessageResult {
    HandledSuccessfully,
    DidNotMatchTrigger,
    UserTimeoutEncountered,
    GlobalTimeoutEncountered,
    CommandExpired,
}

export interface INoInputChatCommand {
    handleMessageWithoutInput(userId: string | undefined, timestamp: Date): Promise<HandleMessageResult>;
}

export interface IRequiredInputChatCommand {
    handleMessageWithInput(detail: IPrivMessageDetail, timestamp: Date): Promise<HandleMessageResult>;
}

/**
 * Represents a generic message handler that triggers from a set of specific command phrases at the start of a message
 */
export interface CommandArgs<TMessageHandler> {
    messageHandler: TMessageHandler;
    /**
     * Globally unique identifier for this command
     */
    commandId: string;
    triggerPhrases: string[];
    strictMatch: boolean;
    globalTimeoutSeconds: number | undefined;
    userTimeoutSeconds: number | undefined;
    expirationDate: Date | undefined;
}

export abstract class ChatCommand<TMessageHandler> {
    protected readonly _messageHandler: TMessageHandler;
    public readonly commandId: string;
    protected readonly _triggerPhrases: string[];
    public get triggerPhrases(): string[] { return Array.from(this._triggerPhrases); }
    public readonly strictMatch: boolean;
    public readonly globalTimeoutSeconds: number | undefined;
    public readonly userTimeoutSeconds: number | undefined;
    public readonly expirationDate: Date | undefined;
    protected readonly _timeoutEndByUser: { [key: string]: number } = {};
    protected readonly _timeoutEndGlobal: number | undefined = undefined;
    
    public constructor(args: CommandArgs<TMessageHandler>) {
        this._messageHandler = args.messageHandler;
        this.commandId = args.commandId;
        this._triggerPhrases = args.triggerPhrases;
        this.strictMatch = args.strictMatch;
        this.globalTimeoutSeconds = args.globalTimeoutSeconds;
        this.userTimeoutSeconds = args.userTimeoutSeconds;
        this.expirationDate = args.expirationDate;
    }

    protected get isExpired(): boolean {
        if (this.expirationDate === undefined) {
            return false;
        }

        const expirationTime = this.expirationDate.getTime();
        if (expirationTime < Date.now()) {
            return false;
        }

        return true;
    }

    protected isTimedOutGlobal(timestamp: Date): boolean {
        if (this._timeoutEndGlobal !== undefined && this._timeoutEndGlobal > timestamp.getTime()) {
            return true;
        }

        return false;
    }

    protected isTimedOutUser(timestamp: Date, userId: string): boolean {
        if (userId !== undefined) {
            const timeout = this._timeoutEndByUser[userId];
            if (timeout !== undefined) {
                if (timeout > timestamp.getTime()) {
                    return true;
                }
            }
        }

        return false;
    }

    protected doesTrigger(message: string): boolean {
        const messageTrim = message.trim();
        for (const trigger of this.triggerPhrases) {
            const triggerTrim = trigger.trim();
            if (!messageTrim || !triggerTrim) {
                continue;
            }

            const messageArr = messageTrim.split(" ");
            const triggerArr = triggerTrim.split(" ");
            if (messageArr.length < triggerArr.length) {
                continue
            }
            if (this.strictMatch && messageArr.length !== triggerArr.length) {
                continue;
            }
            for (let i = 0; i < triggerArr.length; i++) {
                if (messageArr[i] !== triggerArr[i]) {
                    continue;
                }
            }

            return true;
        }

        return false;
    }
}

export type MessageHandler_InputRequired = (detail: IPrivMessageDetail) => Promise<void>;
export type MessageHandler_InputOptional = (detail?: IPrivMessageDetail) => Promise<void>;

export class ChatCommand_InputRequired extends ChatCommand<MessageHandler_InputRequired> implements IRequiredInputChatCommand {    
    public async handleMessageWithInput(detail: IPrivMessageDetail, timestamp: Date): Promise<HandleMessageResult> {
        if (this.isExpired) {
            return HandleMessageResult.CommandExpired;
        }
        if (this.isTimedOutUser(timestamp, detail.username)) {
            return HandleMessageResult.UserTimeoutEncountered;
        }
        if (this.isTimedOutGlobal(timestamp)) {
            return HandleMessageResult.GlobalTimeoutEncountered;
        }
        if (!this.doesTrigger(detail.message)) {
            return HandleMessageResult.DidNotMatchTrigger;
        }

        await this._messageHandler(detail);
        return HandleMessageResult.HandledSuccessfully;
    }
}

export class ChatCommand_InputOptional extends ChatCommand<MessageHandler_InputOptional> implements INoInputChatCommand, IRequiredInputChatCommand {
    public async handleMessageWithoutInput(userId: string | undefined, timestamp: Date): Promise<HandleMessageResult> {
        if (this.isExpired) {
            return HandleMessageResult.CommandExpired;
        }
        if (userId !== undefined && this.isTimedOutUser(timestamp, userId)) {
            return HandleMessageResult.UserTimeoutEncountered;
        }
        if (this.isTimedOutGlobal(timestamp)) {
            return HandleMessageResult.GlobalTimeoutEncountered
        }
        await this._messageHandler();
        return HandleMessageResult.HandledSuccessfully;
    }

    public async handleMessageWithInput(detail: IPrivMessageDetail, timestamp: Date): Promise<HandleMessageResult> {
        if (this.isExpired) {
            return HandleMessageResult.CommandExpired;
        }
        if (this.isTimedOutUser(timestamp, detail.username)) {
            return HandleMessageResult.UserTimeoutEncountered;
        }
        if (this.isTimedOutGlobal(timestamp)) {
            return HandleMessageResult.GlobalTimeoutEncountered;
        }
        if (!this.doesTrigger(detail.message)) {
            return HandleMessageResult.DidNotMatchTrigger;
        }

        await this._messageHandler(detail);
        return HandleMessageResult.HandledSuccessfully;
    }
}

export class ChatCommand_Simple extends ChatCommand_InputOptional {
    public constructor(config: ISimpleCommandConfig) {
        const messageHandler = getSimpleMessageHandler(config);
        const triggerPhrases = [
            config.name,
            ...(config.aliases ?? []),
        ];
        const expirationDate = config.expiresAt
            ? new Date(config.expiresAt)
            : undefined;

        super({
            messageHandler: messageHandler,
            commandId: config.name,
            triggerPhrases: triggerPhrases,
            strictMatch: config.strict ?? false,
            globalTimeoutSeconds: config.globalTimeoutSeconds,
            userTimeoutSeconds: config.userTimeoutSeconds,
            expirationDate: expirationDate,
        });
    }
}

export interface ISimpleCommandConfig {
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
    chatFunc: (message: string) => Promise<void>;
}

export function getSimpleMessageHandler(config: ISimpleCommandConfig) {
    const func = async (): Promise<void> => {
        const index = randomInt(config.responses.length);
        const response = config.responses[index];
        if (response === undefined) {
            throw new Error(`Error picking random response. Using index ${index} out of ${config.responses.length}`);
        }
        await config.chatFunc(response);
        return;
    }

    return func;
}