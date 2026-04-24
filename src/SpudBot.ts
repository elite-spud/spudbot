import { MessageHandler_InputRequired } from "./ChatCommand";
import { IMessageHandlerInput_Twitch } from "./ChatCommand_Twitch";
import { Future } from "./Future";
import { GoogleAPI, GoogleApiConfig } from "./google/GoogleAPI";
import { IIrcBotMiscConfig, ISimpleCommandGroup_Config, IUserDetailCollection } from "./IrcBot";
import { SpudBot_MessageHandlers } from "./SpudBot_MessageHandlers";
import { ISpudBotConfig, ISpudBotConnectionConfig } from "./SpudBotTypes";
import { TaskQueue } from "./TaskQueue";
import { ISimpleCommand_ConfigTwitch, ITwitchUserDetail, TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Event_Raid, TwitchEventSub_Notification_Subscription, TwitchEventSub_SubscriptionType, TwitchUserDetail } from "./TwitchApiTypes";
import { TwitchBotBase } from "./TwitchBot";
import { Utils } from "./Utils";

export class SpudBotTwitch extends TwitchBotBase<TwitchUserDetail> {
    public declare readonly _config: ISpudBotConfig;
    public _firstChatterId: string | undefined = undefined; // TODO: make this a class instead of a public property
    public _firstChatterTimestamp: Date | undefined = undefined;
    protected _raidResponseTaskQueue = new TaskQueue();

    protected readonly _googleApi = new Future<GoogleAPI>();

    public constructor(miscConfig: IIrcBotMiscConfig, connection: ISpudBotConnectionConfig, auxCommandGroups: ISimpleCommandGroup_Config<ISimpleCommand_ConfigTwitch>[], configDir: string) {
        super(miscConfig, connection, auxCommandGroups, configDir);
    }

    public override getServiceName(): string { return "SpudBot" }
    public override async getTwitchBroadcasterId(): Promise<string> {
        return "47243772"; // TODO: make this dynamic (i.e. not elite_spud)
    }

    public override async _startup(): Promise<void> {
        await super._startup();

        const googleApiConfig: GoogleApiConfig = {
            twitchApi: await this._twitchApi,
            connection: this._config.connection.google,
            overfundingEnabled: true,
        }
        const googleApi = new GoogleAPI(googleApiConfig);
        await googleApi.startup();
        this._googleApi.resolve(googleApi);
    }

    protected override getHardcodedMessageHandlers(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch>[] {
        const baseHandlers = super.getHardcodedMessageHandlers();

        const bonkCountFilePath = Utils.getRealDir(`${this._config.configDir}/bonkCount.txt`);
        const forRealCountFilePath = Utils.getRealDir(`${this._config.configDir}/forReal.txt`);
        const spudBotHandlers = new SpudBot_MessageHandlers({
            bonkCountFilePath: bonkCountFilePath,
            forRealCountFilePath: forRealCountFilePath,
            spudBot: this,
            twitchApi: this._twitchApi.asPromise(),
            googleApi: this._googleApi.asPromise(),
        })
        const handlers = [
            ...baseHandlers,
            ...spudBotHandlers.getHandlers(),
        ];
        return handlers;
    }

    protected override async createFreshUserDetail(userId: string): Promise<TwitchUserDetail> {
        const twitchApi = await this._twitchApi;
        const userInfo = await twitchApi.getUserApiInfoSingle(userId);
        if (userInfo === undefined) {
            throw new Error(`Unable to create fresh user detail for userId ${userId}`);
        }
        const twitchUserDetail: TwitchUserDetail = new TwitchUserDetail({
            id: userId,
            username: userInfo.login,
            secondsInChat: 0,
            numChatMessages: 0,
        });
        return twitchUserDetail;
    }

    protected override createUserCollection(jsonCollection: IUserDetailCollection<ITwitchUserDetail>): IUserDetailCollection<TwitchUserDetail> {
        const collection: IUserDetailCollection<TwitchUserDetail> = {};
        for (const userId in jsonCollection) {
            const jsonDetail = jsonCollection[userId]!;
            const detail = new TwitchUserDetail(jsonDetail);
            collection[userId] = detail;
        }
        return collection;
    }

    public override async getPowerupGigantifyBitsCost(): Promise<number> {
        // TODO: track every type of powerup
        return 10; // TODO: Make this contact the TwitchApi to determine cost dynamically
    }

    protected override async handleCheer(event: TwitchEventSub_Event_Cheer, subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        await super.handleCheer(event, subscription);
        const chatFunc = async (message: string): Promise<void> => {
            this.chat(`#${event.broadcaster_user_login}`, message);
        }
        (await this._googleApi).handleCheer(event, subscription, chatFunc);
    }

    protected override async getTwitchEventSubTopics(): Promise<TwitchEventSub_SubscriptionType[]> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        return [{
            name: `channel.channel_points_custom_reward_redemption.add`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.channel_points_custom_reward_redemption.update`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.cheer`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.subscribe`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.subscription.end`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.subscription.gift`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.subscription.message`,
            version: `1`,
            condition: {
                broadcaster_user_id: broadcasterId,
            }
        }, {
            name: `channel.raid`,
            version: `1`,
            condition: {
                to_broadcaster_user_id: broadcasterId,
            }
        },{
            name: `channel.follow`,
            version: `2`,
            condition: {
                broadcaster_user_id: broadcasterId,
                moderator_user_id: broadcasterId, // TODO: make this use the chatbot id (must first use a token authorized by the chatbot account)
            }
        }];
    }

    public async tryAssignFirst(userDetail: TwitchUserDetail, timestamp: Date): Promise<void> {
        const someoneWasAlreadyFirst = this._firstChatterId !== undefined && this._firstChatterTimestamp !== undefined;
        const timestampIsEarlier = this._firstChatterTimestamp === undefined // This check sorts out race conditions where messages can arrive out of order
            ? true
            : timestamp.getTime() < this._firstChatterTimestamp!.getTime();
        if (someoneWasAlreadyFirst && !timestampIsEarlier) {
            console.log(`User ${this._firstChatterId} was already first & the given timestamp occurs later than the logged first timestamp`); // TODO: log trace
            return;
        }

        const broadcasterId = await this.getTwitchBroadcasterId();
        if (userDetail.id === broadcasterId) {
            console.log(`User is broadcaster & cannot be first`);
            return;
        }

        const streamIsLive = await (await this._twitchApi).isChannelLive(broadcasterId);
        if (!streamIsLive) {
            console.log(`Unable to assign first while stream is not live`);
            return;
        }

        console.log(`${userDetail.username} is first.`);
        this._firstChatterId = userDetail.id;
        this._firstChatterTimestamp = timestamp;
        userDetail.numTimesFirst++;
    }

    protected override async handleChannelPointRewardRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        const userDetail = await this.getUserDetailForUserId(event.id);
        await this.tryAssignFirst(userDetail, new Date(event.redeemed_at));

        const chatFunc = async (message: string): Promise<void> => {
            this.chat(`#${event.broadcaster_user_login}`, message);
        }

        if (event.reward.title === "Hi, I'm Lurking!") {
            chatFunc(`${event.user_name}, enjoy your lurk elites72Heart`);
        }

        if (event.reward.title.includes("Contribute to a !GameRequest")) {
            await (await this._googleApi).handleGameRequestContributeRedeem(event, chatFunc, this._pendingTasksByUserId);
        }

        if (event.reward.title === "Submit a new !GameRequest") {
            await (await this._googleApi).handleGameRequestAddRedeem(event, chatFunc);
        }
    }

    protected override async handleRaid(event: TwitchEventSub_Event_Raid, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        const future = new Future<void>();
        this._raidResponseTaskQueue.addTask(() => this.temporarilyDisableChatRestrictions(future, event.to_broadcaster_user_login, event.to_broadcaster_user_name));
        this._raidResponseTaskQueue.startQueue();

        await future;

        const chatRespondTo = `#${event.to_broadcaster_user_login}`;
        const twitchApi = await this._twitchApi;
        const raidingChannelDetails = await twitchApi.getChannelDetails(event.from_broadcaster_user_id);
        const andFriendsString = event.viewers > 3
            ? ` and friends`
            : ``;
        const thankYouString = event.viewers > 3
            ? `Thank you so much for sharing your community with me eeveeHeart `
            : ``;
        this.chat(chatRespondTo, `Welcome @${event.from_broadcaster_user_name}${andFriendsString}! ${thankYouString}I hope your ${raidingChannelDetails.game_name} stream was enjoyable!`);

        return;
    }
}