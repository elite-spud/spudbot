import { MessageHandler_Simple, HandleMessageResult, IMessageHandler_Simple_Config, IMessageHandlerInput } from "./ChatCommand";
import { TwitchApi } from "./TwitchApi";

export interface IMessageHandlerInput_Twitch extends IMessageHandlerInput {
    userIsModerator: boolean;
    userIsVIP: boolean;
    userIsBroadcaster: boolean;
    messageContainsGigantifiedEmote: boolean;
}

export interface IMessageHandler_SimpleTwitch_Config extends IMessageHandler_Simple_Config {
    autoPostGameWhitelist?: string[];
    autoPostIfTitleContainsAny?: string[];
    twitchApi: Promise<TwitchApi>;
}

export class MessageHandler_SimpleTwitch extends MessageHandler_Simple {
    protected readonly _autoPostGameWhitelist: string[] | undefined;
    protected readonly _autoPostIfTitleContainsAny: string[] | undefined;
    protected readonly _twitchApi: Promise<TwitchApi>;

    public constructor(config: IMessageHandler_SimpleTwitch_Config) {
        super(config);
        this._autoPostGameWhitelist = config.autoPostGameWhitelist;
        this._autoPostIfTitleContainsAny = config.autoPostIfTitleContainsAny;
        this._twitchApi = config.twitchApi;
    }

    protected async gameMatchesAutopostWhitelist(): Promise<boolean> {
        if (this._autoPostGameWhitelist === undefined) {
            return true;
        }

        const twitchApi = await this._twitchApi;
        const broadcasterId = await twitchApi.getTwitchBroadcasterId();
        const channelDetails = await twitchApi.getChannelDetails(broadcasterId);
        const gameInWhitelist = this._autoPostGameWhitelist.some(n => n.toLowerCase() === channelDetails.game_name.toLowerCase());
        return gameInWhitelist;
    }

    protected async titleMatchesAutopostWhitelist(): Promise<boolean> {
        if (this._autoPostIfTitleContainsAny === undefined) {
            return true;
        }

        const twitchApi = await this._twitchApi;
        const broadcasterId = await twitchApi.getTwitchBroadcasterId();
        const streamDetails = await twitchApi.getChannelDetails(broadcasterId);
        const titleInWhitelist = this._autoPostIfTitleContainsAny.some(n => streamDetails.title.includes(n));
        return titleInWhitelist;
    }

    protected override async checkTriggers_WithInput(input: IMessageHandlerInput, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult | undefined> {
        const result = await super.checkTriggers_WithInput(input, timestamp, ignoreTimeout);
        if (result !== undefined) {
            return result;
        }

        return undefined;
    }

    protected override async checkTriggers_WithoutInput(userId: string | undefined, timestamp: Date, ignoreTimeout: boolean): Promise<HandleMessageResult | undefined> {
        const result = await super.checkTriggers_WithoutInput(userId, timestamp, ignoreTimeout);
        if (result !== undefined) {
            return result;
        }

        if (userId === undefined) {
            const titleMatches = await this.titleMatchesAutopostWhitelist();
            if (!titleMatches) {
                return HandleMessageResult.MiscNotHandled;
            }
    
            const gameMatches = await this.gameMatchesAutopostWhitelist();
            if (!gameMatches) {
                return HandleMessageResult.MiscNotHandled;
            }
        }

        return undefined;
    }
}