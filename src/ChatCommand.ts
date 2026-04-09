import { randomInt } from "crypto";

export enum HandleMessageResult {
    HandledSuccessfully = 0,
    DidNotMatchTrigger = 1,
    UserTimeoutEncountered = 2,
    GlobalTimeoutEncountered = 3,
    Expired = 4,
    MiscNotHandled = 5,
}

export interface IMessageHandlerInput {
    userId: string;
    username: string;
    message: string;
    chat(message: string, replyToTriggeringMessage?: boolean): Promise<void>;
}

export interface IMessageHandler_AcceptsNoInput {
    handleMessageWithoutInput(userId: string | undefined, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult>;
}

export interface IMessageHandler_AcceptsInput<TInput extends IMessageHandlerInput = IMessageHandlerInput> {
    handleMessageWithInput(input: TInput, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult>;
}

export interface IMessageHandler_InputOptional<TInput extends IMessageHandlerInput = IMessageHandlerInput> extends IMessageHandler_AcceptsNoInput, IMessageHandler_AcceptsInput<TInput> {
}

/**
 * Represents a generic message handler that triggers from a set of specific command phrases at the start of a message
 */
export interface MessageHandler_Config {
    /**
     * Globally unique identifier for this handler
     */
    handlerId: string;
    /** undefined triggers on every message, empty array never triggers */
    triggerPhrases: string[] | undefined;
    strictMatch: boolean;
    globalTimeoutSeconds?: number;
    userTimeoutSeconds?: number;
    expirationDate?: Date;
}

export abstract class MessageHandler {
    public readonly handlerId: string;
    protected readonly _triggerPhrases: string[] | undefined;
    public get triggerPhrases(): string[] | undefined {
        return this._triggerPhrases === undefined
            ? undefined
            : Array.from(this._triggerPhrases);
    }
    public readonly strictMatch: boolean;
    public readonly globalTimeoutSeconds: number | undefined;
    public readonly userTimeoutSeconds: number | undefined;

    public expirationDate: Date | undefined;
    protected _timeoutEndByUser: { [key: string]: Date } = {};
    protected _timeoutEndGlobal: Date | undefined = undefined;
    
    public constructor(args: MessageHandler_Config) {
        this.handlerId = args.handlerId;
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
            return true;
        }

        return false;
    }

    protected isTimedOutGlobal(timestamp: Date): boolean {
        if (this._timeoutEndGlobal !== undefined && this._timeoutEndGlobal.getTime() > timestamp.getTime()) {
            return true;
        }

        return false;
    }

    protected isTimedOutUser(timestamp: Date, userId: string): boolean {
        if (userId !== undefined) {
            const timeout = this._timeoutEndByUser[userId];
            if (timeout !== undefined) {
                if (timeout.getTime() > timestamp.getTime()) {
                    return true;
                }
            }
        }

        return false;
    }

    protected aliasMatched(message: string): boolean {
        if (this.triggerPhrases === undefined) {
            return true;
        }

        for (const triggerPhrase of this.triggerPhrases) {
            const matchFound = this.strictMatch
                ? message === triggerPhrase
                : message.includes(triggerPhrase);

            if (matchFound) {
                return true;
            }
        }

        return false;
    }
}

export interface MessageHandler_InputRequired_Config<TInput extends IMessageHandlerInput> extends MessageHandler_Config {
    handleMessage: (input: TInput) => Promise<void>;
}

export class MessageHandler_InputRequired<TInput extends IMessageHandlerInput = IMessageHandlerInput> extends MessageHandler implements IMessageHandler_AcceptsInput<TInput> {    
    protected readonly _messageHandler: (input: TInput) => Promise<void>;

    public constructor(config: MessageHandler_InputRequired_Config<TInput>) {
        super(config);
        this._messageHandler = config.handleMessage;
    }
    
    public checkTriggers(input: TInput, timestamp: Date, ignoreTimeout: boolean): HandleMessageResult | undefined {
        if (this.isExpired) {
            return HandleMessageResult.Expired;
        }
        if (!ignoreTimeout && this.isTimedOutUser(timestamp, input.userId)) {
            return HandleMessageResult.UserTimeoutEncountered;
        }
        if (!ignoreTimeout && this.isTimedOutGlobal(timestamp)) {
            return HandleMessageResult.GlobalTimeoutEncountered;
        }
        if (!this.aliasMatched(input.message)) {
            return HandleMessageResult.DidNotMatchTrigger;
        }

        return undefined;
    }
    
    public async handleMessageWithInput(input: TInput, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult> {
        const triggerResult = this.checkTriggers(input, timestamp, ignoreTimeout);
        if (triggerResult !== undefined) {
            return triggerResult;
        }

        await this._messageHandler(input);
        this._timeoutEndGlobal = timestamp;
        this._timeoutEndByUser[input.userId] = timestamp;
        return HandleMessageResult.HandledSuccessfully;
    }
}

export interface MessageHandler_InputOptional_Config<TInput extends IMessageHandlerInput = IMessageHandlerInput> extends MessageHandler_Config {
    handleMessage: (input?: TInput) => Promise<void>;
}

export class MessageHandler_InputOptional<TInput extends IMessageHandlerInput = IMessageHandlerInput> extends MessageHandler implements IMessageHandler_InputOptional<TInput> {
    protected readonly _messageHandler: (input?: TInput) => Promise<void>;

    public constructor(config: MessageHandler_InputOptional_Config<TInput>) {
        super(config);
        this._messageHandler = config.handleMessage;
    }
    
    protected async checkTriggers_WithInput(input: TInput, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult | undefined> {
        if (this.isExpired) {
            return HandleMessageResult.Expired;
        }
        if (!ignoreTimeout && this.isTimedOutUser(timestamp, input.userId)) {
            return HandleMessageResult.UserTimeoutEncountered;
        }
        if (!ignoreTimeout && this.isTimedOutGlobal(timestamp)) {
            return HandleMessageResult.GlobalTimeoutEncountered;
        }
        if (!this.aliasMatched(input.message)) {
            return HandleMessageResult.DidNotMatchTrigger;
        }

        return undefined;
    }

    protected async checkTriggers_WithoutInput(userId: string | undefined, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult | undefined> {
        if (this.isExpired) {
            return HandleMessageResult.Expired;
        }
        if (!ignoreTimeout && userId !== undefined && this.isTimedOutUser(timestamp, userId)) {
            return HandleMessageResult.UserTimeoutEncountered;
        }
        if (!ignoreTimeout && this.isTimedOutGlobal(timestamp)) {
            return HandleMessageResult.GlobalTimeoutEncountered
        }

        return undefined;
    }
    
    public async handleMessageWithoutInput(userId: string | undefined, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult> {
        const triggerResult = await this.checkTriggers_WithoutInput(userId, timestamp, ignoreTimeout);
        if (triggerResult !== undefined) {
            return triggerResult;
        }
        
        await this._messageHandler();
        this._timeoutEndGlobal = timestamp;
        return HandleMessageResult.HandledSuccessfully;
    }

    public async handleMessageWithInput(input: TInput, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult> {
        const triggerResult = await this.checkTriggers_WithInput(input, timestamp, ignoreTimeout);
        if (triggerResult !== undefined) {
            return triggerResult;
        }

        await this._messageHandler(input);
        this._timeoutEndGlobal = timestamp;
        this._timeoutEndByUser[input.userId] = timestamp;
        return HandleMessageResult.HandledSuccessfully;
    }
}

export interface IMessageHandler_Simple_Config {
    name: string;
    aliases?: string[];
    /** Matches names exactly (ignoring whitespace) */
    strict?: boolean; // TODO: allow specifying strict match for each name/alias, not all.
    /** Date string */
    expirationDate?: Date;
    responses: string[];
    /** Delay until this handler can be triggered again by a particular user (defaults to 30 seconds) */
    userTimeoutSeconds?: number;
    /** Delay until this handler can be triggered again by any user (defaults to 0 seconds) */
    globalTimeoutSeconds?: number;
    chatFunc: (message: string) => Promise<void>;
}

export class MessageHandler_Simple<TInput extends IMessageHandlerInput = IMessageHandlerInput> extends MessageHandler_InputOptional<TInput> {
    public constructor(config: IMessageHandler_Simple_Config) {
        const messageHandler = getSimpleMessageHandlerFunc(config);
        const triggerPhrases = [
            config.name,
            ...(config.aliases ?? []),
        ];
        const expirationDate = config.expirationDate
            ? config.expirationDate
            : undefined;

        super({
            handleMessage: messageHandler,
            handlerId: config.name,
            triggerPhrases: triggerPhrases,
            strictMatch: config.strict ?? false,
            globalTimeoutSeconds: config.globalTimeoutSeconds,
            userTimeoutSeconds: config.userTimeoutSeconds,
            expirationDate: expirationDate,
        });
    }
}

export function getSimpleMessageHandlerFunc(config: IMessageHandler_Simple_Config): () => Promise<void> {
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