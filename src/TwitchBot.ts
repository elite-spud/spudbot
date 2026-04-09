import { WebSocket } from "ws";
import { MessageHandler_InputRequired, MessageHandler_InputRequired_Config } from "./ChatCommand";
import { IMessageHandlerInput_Twitch } from "./ChatCommand_Twitch";
import { ConsoleColors } from "./ConsoleColors";
import { Future } from "./Future";
import { IIrcBotMiscConfig, IIrcBotSimpleMessageHandlersConfig, IPrivMessageDetail, IrcBotBase } from "./IrcBot";
import { knownBots } from "./KnownBots";
import { TaskQueue } from "./TaskQueue";
import { TwitchApi, TwitchApiConfig } from "./TwitchApi";
import { emoteWasGigantified, ITwitchBotConfig, ITwitchBotConnectionConfig, SubTierPoints, TwitchBadgeTagKeys, TwitchChatSettings, TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Event_Follow, TwitchEventSub_Event_Raid, TwitchEventSub_Event_SubscriptionEnd, TwitchEventSub_Event_SubscriptionGift, TwitchEventSub_Event_SubscriptionMessage, TwitchEventSub_Event_SubscriptionStart, TwitchEventSub_Notification_Payload, TwitchEventSub_Notification_Subscription, TwitchEventSub_Reconnect_Payload, TwitchEventSub_SubscriptionType, TwitchEventSub_Welcome_Payload, TwitchPrivMessageTagCollection, TwitchPrivMessageTagKeys, TwitchSubscriptionDetail, TwitchUserDetail, userIsModerator, userIsVip } from "./TwitchApiTypes";

export abstract class TwitchBotBase<TUserDetail extends TwitchUserDetail = TwitchUserDetail> extends IrcBotBase<TUserDetail, IMessageHandlerInput_Twitch> {
    public static readonly twitchMaxChatMessageLength = 500;
    protected static readonly _knownConfig: { encoding: "utf8" } = { encoding: "utf8" };

    public declare readonly _config: ITwitchBotConfig;
    protected readonly _twitchApi: Future<TwitchApi> = new Future<TwitchApi>();

    protected _twitchEventSub: Future<WebSocket> = new Future<WebSocket>;
    protected _twitchEventSubTemp: WebSocket | undefined = undefined;

    protected _raidResponseTaskQueue = new TaskQueue();
    protected _chatSettingsPriorToRaidOverride?: TwitchChatSettings;
    protected _raidOverrideTimeouts?: { warning: NodeJS.Timeout, final: NodeJS.Timeout };

    protected _currentSubPoints?: number = undefined;
    protected _currentSubCount?: number = undefined;

    protected override get maxChatMessageLength(): number {
        return this._config.misc.maxChatMessageLength ?? TwitchBotBase.twitchMaxChatMessageLength;
    }

    public abstract getPowerupGigantifyBitsCost(): Promise<number>;

    public constructor(miscConfig: IIrcBotMiscConfig, connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotSimpleMessageHandlersConfig[], configDir: string) {
        super(Object.assign(
            TwitchBotBase._knownConfig,
            { connection, auxCommandGroups, configDir, misc: miscConfig }
        ));
    }

    protected override getHardcodedMessageHandlers(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch>[] {
        const baseHandlers = super.getHardcodedMessageHandlers();
        const handlers = [
            ...baseHandlers,
            this.getHandler_Powerup(),
        ];
        return handlers;
    }

    public override async _startup(): Promise<void> {
        await super._startup();

        const twitchApiConfig: TwitchApiConfig = {
            twitchBroadcasterChannel: this._config.connection.server.channel,
            authConfig: this._config.connection.twitch.oauth,
            serviceName: this.getServiceName(),
        };
        const twitchApi = new TwitchApi(twitchApiConfig);
        await twitchApi.startup();
        this._twitchApi.resolve(twitchApi);

        const existingSubscriptions = await twitchApi.getEventSubSubscriptions();
        console.log(`  ${ConsoleColors.FgYellow}Current number of EventSub Subscriptions: ${existingSubscriptions.length}${ConsoleColors.Reset}\n`);
        await twitchApi.deleteUnusedEventSubSubscriptions(existingSubscriptions);

        const twitchEventSub = this.createTwitchEventSubWebsocket("wss://eventsub.wss.twitch.tv/ws");
        this._twitchEventSub.resolve(twitchEventSub);

        this.sendRaw("CAP REQ :twitch.tv/membership"); // Request capability to receive JOIN and PART events from users connecting to channels
        this.sendRaw("CAP REQ :twitch.tv/commands"); // Request capability to send & receive twitch-specific commands (timeouts, chat clears, host notifications, subscriptions, etc.)
        this.sendRaw("CAP REQ :twitch.tv/tags"); // Request capability to augment certain IRC messages with tag metadata

        const activeSubInfo = await twitchApi.getActiveBroadcasterSubcriptions();
        this.updateSubscribedUsers(activeSubInfo.subDetails);
        this._currentSubCount = activeSubInfo.subCount;
        this._currentSubPoints = activeSubInfo.subPoints;
    }

    protected override async trackUsersInChat(secondsToAdd: number, force: boolean = false): Promise<void> {
        const twitchApi = await this._twitchApi;
        const isChannelLive = await twitchApi.isChannelLive(twitchApi.twitchBroadcasterChannel);
        if (!force && !isChannelLive) {
            return;
        }

        super.trackUsersInChat(secondsToAdd);
    }

    protected override async createMessageInput(detail: IPrivMessageDetail): Promise<IMessageHandlerInput_Twitch> {
        const userId = await this.getUserIdForUsername(detail.username);
        if (userId === undefined) {
            throw new Error(`Cannot create MessageHandlerInput with null userId`);
        }
        const twitchMessageTags: TwitchPrivMessageTagCollection = this.parseTwitchMessageTags(detail)
        const messageContainsGigantifiedEmote = emoteWasGigantified(twitchMessageTags);
        const userIsBroadcaster = await this.getTwitchBroadcasterId() === userId;
        const chatFunc = async (message: string): Promise<void> => {
            this.chat(detail.respondTo, message);
        }

        const inputTwitch: IMessageHandlerInput_Twitch = {
            userId: userId,
            username: detail.username,
            message: detail.message,
            userIsBroadcaster: userIsBroadcaster,
            userIsModerator: userIsModerator(twitchMessageTags),
            userIsVIP: userIsVip(twitchMessageTags),
            messageContainsGigantifiedEmote: messageContainsGigantifiedEmote,
            chat: chatFunc,
        };
        return inputTwitch;
    }

    protected parseTwitchMessageTags(detail: IPrivMessageDetail): TwitchPrivMessageTagCollection {
        const tags = detail.tags;
        if (tags === undefined || tags === "") {
            return {};
        }

        const parsedTags: { [key in TwitchPrivMessageTagKeys]: string } = {};
        const tagsCleaned = tags.startsWith("@")
            ? tags.slice(1, tags.length)
            : tags;
        const tagsStrArr = tagsCleaned.split(";");
        for (const tag of tagsStrArr) {
            const splitTag = tag.split("=");
            if (splitTag.length !== 2) {
                console.log(`Failed to parse a twitch tag: ${tag}. Expected only 2 parts after splitting on '='`);
                continue;
            }
            const key = splitTag[0]!;
            const value = splitTag[1]!;
            parsedTags[key] = value;
        }

        return parsedTags;
    }

    protected parseTwitchMessageBadges(tags: TwitchPrivMessageTagCollection): { [badgeName in TwitchBadgeTagKeys]: string } {
        const badges = tags["badges"];
        if (badges === undefined || badges === "") {
            return {};
        }

        const badgeVersionsByBadgeName: { [badgeName in TwitchBadgeTagKeys]: string } = {};
        const badgesSplit = badges.split(",");
        for (const badge of badgesSplit) {
            const badgeSplit = badge.split("/");
            if (badgeSplit.length !== 2) {
                console.log(`Failed to parse a twitch badge tag: ${badge}. Expected only 2 parts after splitting on '/'`);
                continue;
            }
            const badgeName = badgeSplit[0]!;
            const badgeVersion = badgeSplit[1]!;
            badgeVersionsByBadgeName[badgeName] = badgeVersion;
        }
        return badgeVersionsByBadgeName;
    }

    public abstract getServiceName(): string;

    public abstract getTwitchBroadcasterId(): Promise<string>;

    protected abstract getTwitchEventSubTopics(): Promise<TwitchEventSub_SubscriptionType[]>;

    protected async onEventSubOpen(): Promise<void> {
        console.log(`  ${ConsoleColors.FgYellow}${"Opened EventSub"}${ConsoleColors.Reset}\n`);
    }

    protected createTwitchEventSubWebsocket(url: string): WebSocket {
        const twitchEventSub = new WebSocket(url);
        twitchEventSub.on("error", (err) => this.onError(err));
        twitchEventSub.on("open", async () => await this.onEventSubOpen());
        twitchEventSub.on("message", (msg) => this.onEventSubMessage(msg));
        twitchEventSub.on("close", (code, reason) => console.log(`EventSub Closed! Code: ${code} Reason: ${reason}`));

        return twitchEventSub;
    }

    protected async onEventSubMessage(msg: any): Promise<void> {
        const messageJson: any = JSON.parse(msg.toString());
        if (messageJson.metadata.message_type === "session_keepalive") {
            return; // TODO: attempt reconnection when these don't appear as expected, but don't log them above Trace level
        }
        console.log(`  ${ConsoleColors.FgYellow}EventSub Message Received! ${msg}${ConsoleColors.Reset}\n`);
        if (messageJson.metadata.message_type === "session_welcome") {
            await this.handleEventSubWelcome(messageJson.payload);
        } else if (messageJson.metadata.message_type === "session_reconnect") {
            await this.handleEventSubReconnect(messageJson.payload);
        } else if (messageJson.metadata.message_type === "notification") {
            await this.handleEventSubNotification(messageJson.payload);
        }
    }

    protected async handleEventSubWelcome(payload: TwitchEventSub_Welcome_Payload): Promise<void> {
        if (this._twitchEventSubTemp) { // This is the first welcome message after a reconnect was issued.
            const originalEventSub = await this._twitchEventSub;
            this._twitchEventSub = new Future<WebSocket>();
            this._twitchEventSub.resolve(this._twitchEventSubTemp);
            originalEventSub.close();
            this._twitchEventSubTemp = undefined;
            console.log(`  ${ConsoleColors.FgYellow}Reconnected to new EventSub websocket!${ConsoleColors.Reset}\n`);
            return;
        }

        let numAttemptedSubscriptions = 0;
        let numNewSubscriptions = 0;
        const twitchApi = await this._twitchApi;
        for (const topic of await this.getTwitchEventSubTopics()) { // Cannot send arrays of subscriptions, must do one by one
            numAttemptedSubscriptions++;
            try {
                await twitchApi.createEventSubSubscription(topic, payload.session.id);
            } catch (err) {
                continue;
            }
            numNewSubscriptions++;
        }
        console.log(`  ${ConsoleColors.FgYellow}Subscribed to ${numNewSubscriptions}/${numAttemptedSubscriptions} EventSub Topics!${ConsoleColors.Reset}\n`);
    }

    protected async handleEventSubReconnect(payload: TwitchEventSub_Reconnect_Payload): Promise<void> {
        this._twitchEventSubTemp = this.createTwitchEventSubWebsocket(payload.session.reconnect_url);
    }

    protected async handleEventSubNotification(notificationMessage: TwitchEventSub_Notification_Payload): Promise<void> {
        try {
            if (notificationMessage.subscription.type === "channel.channel_points_custom_reward_redemption.add") {
                await this.handleChannelPointRewardRedeem(notificationMessage.event as TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.subscribe") {
                await this.handleSubscriptionStart(notificationMessage.event as TwitchEventSub_Event_SubscriptionStart, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.subscription.end") {
                await this.handleSubscriptionEnd(notificationMessage.event as TwitchEventSub_Event_SubscriptionEnd, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.subscription.message") {
                await this.handleSubscriptionMessage(notificationMessage.event as TwitchEventSub_Event_SubscriptionMessage, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.subscription.gift") {
                await this.handleSubscriptionGift(notificationMessage.event as TwitchEventSub_Event_SubscriptionGift, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.cheer") {
                await this.handleCheer(notificationMessage.event as TwitchEventSub_Event_Cheer, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.hype_train.begin") {
                
            } else if (notificationMessage.subscription.type === "channel.hype_train.progress") {
                
            } else if (notificationMessage.subscription.type === "channel.hype_train.end") {
                
            } else if (notificationMessage.subscription.type === "channel.prediction.begin") {
                
            } else if (notificationMessage.subscription.type === "channel.raid") {
                await this.handleRaid(notificationMessage.event as TwitchEventSub_Event_Raid, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.follow") {
                await this.handleFollow(notificationMessage.event as TwitchEventSub_Event_Follow, notificationMessage.subscription);
            } else if (notificationMessage.subscription.type === "channel.ad_break.begin") {
                
            }
        } catch (err) {
            console.log("Error processing eventSub notification: ");
            console.log(err);
            console.error("Error processing eventSub notification: "); // TODO: actually use this output stream
            console.error(err);
        }
    }

    protected abstract handleChannelPointRewardRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, subscription: TwitchEventSub_Notification_Subscription): Promise<void>;

    protected async handleSubscriptionStart(event: TwitchEventSub_Event_SubscriptionStart, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        if (!this._currentSubPoints || !this._currentSubCount)
            return;

        this._currentSubPoints += SubTierPoints.getPointsByTier(event.tier);
        this._currentSubCount += 1;
    }

    protected async handleSubscriptionEnd(event: TwitchEventSub_Event_SubscriptionEnd, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        if (!this._currentSubPoints || !this._currentSubCount)
            return;

        this._currentSubPoints -= SubTierPoints.getPointsByTier(event.tier);
        this._currentSubCount -= 1;
    }

    protected async handleSubscriptionMessage(event: TwitchEventSub_Event_SubscriptionMessage, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        let userDetail: TUserDetail | undefined;
        try {
            userDetail = await this.getUserDetailForUserId(event.user_id);
        } catch (err) {
            console.log(`Error retrieving userDetail for user: ${event.user_login} ${event.user_id}`);
            console.log(err);
            return;
        }

        userDetail.lastKnownSubscribedDate = new Date();
        userDetail.monthsSubscribed = event.cumulative_months;
        userDetail.currentSubcriptionStreak = event.streak_months ?? 0;
        userDetail.subscriptionTier = event.tier;

        if (!userDetail.firstKnownSubscribedDate) {
            userDetail.firstKnownSubscribedDate = new Date();
        } else if (event.cumulative_months > 1) {
            const earliestDate = new Date(userDetail.lastKnownSubscribedDate);
            earliestDate.setMonth(userDetail.lastKnownSubscribedDate.getMonth() - (event.cumulative_months - 1));
            if (userDetail.firstKnownSubscribedDate.getTime() > earliestDate.getTime()) {
                userDetail.firstKnownSubscribedDate = earliestDate;
            }
        }
    }

    protected async handleSubscriptionGift(_event: TwitchEventSub_Event_SubscriptionGift, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
    }

    public async trackUserBits2(userId: string, numBits: number) {
        let userDetail: TUserDetail | undefined;
        try {
            userDetail = await this.getUserDetailForUserId(userId);
        } catch (err) {
            console.log(`Error retrieving userDetail for userId: ${userId}`);
            console.log(err);
            return;
        }

        userDetail.numBitsCheered = userDetail.numBitsCheered === undefined
            ? numBits
            : userDetail.numBitsCheered + numBits
    }

    protected async handleCheer(event: TwitchEventSub_Event_Cheer, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        if (event.is_anonymous || !event.user_id) {
            return;
        }

        await this.trackUserBits2(event.user_id, event.bits);
    }

    protected setChatSettingsOverrideTimeouts(overrideMillis: number, warningMillis: number, chatRespondTo: string): void {
        const finalTimeout = setTimeout(async () => {
            if (this._chatSettingsPriorToRaidOverride === undefined) { // settings have already been reverted
                return;
            }
            const twitchApi = await this._twitchApi;
            await twitchApi.updateChatSettings(this._chatSettingsPriorToRaidOverride);
            this._chatSettingsPriorToRaidOverride = undefined;
        }, overrideMillis);

        const warningTimeout = setTimeout(async () => {
            if (this._chatSettingsPriorToRaidOverride === undefined) { // settings have already been reverted
                return;
            }
            const minutesUntilRevert = (overrideMillis - warningMillis) / 1000 / 60;
            this.chat(chatRespondTo, `Followers-only mode will be re-enabled in ${minutesUntilRevert} minutes. Consider following the channel if you'd like to keep chatting! eeveeHeart`);
        }, warningMillis);

        if (this._raidOverrideTimeouts !== undefined) {
            clearTimeout(this._raidOverrideTimeouts.warning);
            clearTimeout(this._raidOverrideTimeouts.final);
            console.log(`Timeouts cleared.`);
        }
        this._raidOverrideTimeouts = {
            final: finalTimeout,
            warning: warningTimeout,
        };
    }

    protected async temporarilyDisableChatRestrictions(future: Future<void>, broadcasterLogin: string, broadcasterName: string): Promise<void> {
        const twitchApi = await this._twitchApi;
        const shieldModeEnabled: boolean = await twitchApi.isShieldModeEnabled();
        if (shieldModeEnabled) { // Do not interfere at all if shield mode is enabled, because editing settings will edit shield mode
            future.resolve();
            return;
        }

        const chatRespondTo = `#${broadcasterLogin}`;
        
        const currentChatSettings = await twitchApi.getChatSettings();
        // const originalChatSettings = this._chatSettingsPriorToRaidOverride ?? currentChatSettings;

        // const overrideMinutes = originalChatSettings.follower_mode_duration * 2;
        // const warningMinutes = originalChatSettings.follower_mode_duration - 3;

        const overrideMinutes = 10;
        const warningMinutes = 5;

        const overrideMillis = 1000 * 60 * overrideMinutes;
        const warningMillis = 1000 * 60 * warningMinutes;

        if (!!this._chatSettingsPriorToRaidOverride) { // override in effect
            this.setChatSettingsOverrideTimeouts(overrideMillis, warningMillis, chatRespondTo);
            future.resolve();
            return;
        }

        const currentChatSettingsAreRestrictive = currentChatSettings.follower_mode === true;
        if (!currentChatSettingsAreRestrictive) { // no need to override anything
            future.resolve();
            return;
        }
        this._chatSettingsPriorToRaidOverride = currentChatSettings;

        try {
            await twitchApi.updateChatSettings({
                follower_mode: false,
            });
            this.chat(chatRespondTo, `Raid incoming! Chat restrictions have been temporarily disabled so that raiders can speak freely.`);
        } catch (err) {
            this.chat(chatRespondTo, `Error disabling chat restrictions in response to incoming raid. @${broadcasterName}, could you please disable them manually?`);
            future.reject(err);
            return;
        }

        this.setChatSettingsOverrideTimeouts(overrideMillis, warningMillis, chatRespondTo);

        future.resolve();
        return;
    }

    protected async handleRaid(event: TwitchEventSub_Event_Raid, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        const future = new Future<void>();
        this._raidResponseTaskQueue.addTask(() => this.temporarilyDisableChatRestrictions(future, event.to_broadcaster_user_login, event.to_broadcaster_user_name));
        this._raidResponseTaskQueue.startQueue();

        await future;

        const chatRespondTo = `#${event.to_broadcaster_user_login}`;
        const twitchApi = await this._twitchApi;
        const raidingChannelDetails = await twitchApi.getChannelDetails(event.from_broadcaster_user_login);
        const andFriendsString = event.viewers > 3
            ? ` and friends`
            : ``;
        const thankYouString = event.viewers > 3
            ? `Thank you so much for sharing your community with me eeveeHeart `
            : ``;
        this.chat(chatRespondTo, `Welcome @${event.from_broadcaster_user_name}${andFriendsString}! ${thankYouString}I hope your ${raidingChannelDetails.game_name} stream was enjoyable!`);

        return;
    }

    protected async handleFollow(event: TwitchEventSub_Event_Follow, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        let userDetail: TUserDetail | undefined;
        try {
            userDetail = await this.getUserDetailForUserId(event.user_id);
        } catch (err) {
            console.log(`Error updating followed user: ${event.user_login} Expected user detail to exist for user id ${event.user_id}`);
            console.log(err);
            return;
        }

        userDetail.isFollower = true;
        if (!userDetail.followDates) {
            userDetail.followDates = [];
        }
        userDetail.followDates.push(new Date(event.followed_at));
    }

    protected async updateSubscribedUsers(subDetails: TwitchSubscriptionDetail[]): Promise<void> {
        const subscribedUserIds = subDetails.map(n => n.user_id);
        const userDetailPromisesByUserId = this.getUserDetailsForUserIds(subscribedUserIds);

        for (const sub of subDetails) {
            let userDetail: TUserDetail | undefined;
            try {
                userDetail = await userDetailPromisesByUserId[sub.user_id];
            } catch (err) {
                console.log(`Error updating subscribed user: ${sub.user_login} ${sub.user_id}`);
                console.log(err);
                continue;
            }
            if (userDetail === undefined) {
                console.log(`Error updating subscribed user: ${sub.user_login}. Expected user detail to exist for user id ${sub.user_id}`);
                continue;
            }
            userDetail.subscriptionTier = sub.tier;
            userDetail.lastKnownSubscribedDate = new Date();
            userDetail.lastSubWasGifted = sub.is_gift;
            if (sub.is_gift) {
                userDetail.hasReceivedGiftSub = sub.is_gift;
            }

            if (!userDetail.firstKnownSubscribedDate) {
                userDetail.firstKnownSubscribedDate = new Date(userDetail.lastKnownSubscribedDate);
            }
        }
    }

    public override async getUserIdsForUsernames(usernames: string[]): Promise<{ [username: string]: string | undefined; }> {
        const twitchApi = await this._twitchApi;
        return twitchApi.getUserIdsForUsernames(usernames);
    }

    protected async updateFollowers(): Promise<void> {
        const twitchApi = await this._twitchApi;
        const followingUsers = await twitchApi.getFollowers();
        const userDetailPromisesByUserId = await this.getUserDetailsForUserIds(followingUsers.map(n => n.user_id));

        for (const followingUser of followingUsers) {
            let userDetail: TUserDetail | undefined;
            try {
                userDetail = await userDetailPromisesByUserId[followingUser.user_id];
            } catch (err) {
                console.log(`Error updating following user: ${followingUser.user_login}`);
                console.log(err);
                continue;
            }
            if (userDetail === undefined) {
                console.log(`Error updating following user: ${followingUser.user_login}. Expected user detail to exist for user id ${followingUser.user_login}`);
                continue;
            }

            userDetail.isFollower = true;
            if (userDetail.followDates === undefined) {
                userDetail.followDates = [];
            }
            userDetail.followDates.push(new Date(followingUser.followed_at));
        }

        // Flag all non-followers
        const knownUserIds = this.getKnownUserIds();
        const userDetailIndex = this.getUserDetailsForUserIds(knownUserIds);
        for (const userIdKey in userDetailIndex) {
            const detail = await userDetailIndex[userIdKey]!;
            if (!followingUsers.some(n => n.user_id === detail.id)) { // TODO: optimize this (merge the list of userIds and iterate once, perhaps?)
                detail.isFollower = false;
            }
        }
    }

    public async updateAllUsers(): Promise<void> {
        await this.updateFollowers();
        const knownUserIds = this.getKnownUserIds();
        const twitchApi = await this._twitchApi;
        const userApiInfoByUserId = await twitchApi.getUserApiInfo(knownUserIds, []);
        let numDeletedUsers = 0;
        let numOutdatedUsernames = 0;
        let numBannedBots = 0;
        let numSyncedBans = 0;
        let numUnbannedUsers = 0;

        const bannedUsers = await twitchApi.getBannedUsers();

        for (const userIdKey in userApiInfoByUserId) {
            const userDetail = await this.getUserDetailForUserId(userIdKey);
            if (userDetail === undefined) {
                console.log(`Error updating user: ${userIdKey}. Expected user detail to exist for user id`);
                continue;
            }
            const userApiInfo = userApiInfoByUserId[userIdKey];

            if (!userApiInfo) {
                if (!userDetail.isDeleted) {
                    numDeletedUsers++;
                    userDetail.isDeleted = true;
                }
                continue;
            }

            userDetail.isDeleted = false;
            if (userApiInfo.login !== userDetail.username) {
                this.updateUsername(userDetail, userApiInfo.login);
                numOutdatedUsernames++;
            }
            userDetail.broadcasterType = userApiInfo.broadcaster_type;

            const userInBannedList = bannedUsers.some(n => n.user_id === userDetail.id);

            if (userDetail.isBanned && !userInBannedList) {
                numUnbannedUsers++;
                userDetail.isBanned = false;
                console.log(`Synced unban against ${userDetail.username}`);
            }

            if (!userDetail.isBanned && userInBannedList) {
                numSyncedBans++;
                userDetail.isBanned = true;
                console.log(`Synced ban against ${userDetail.username}`);
            }

            const userIsABot = knownBots.some(n => n === userDetail.username);
            if (userIsABot && userDetail.isBanned !== true) {
                numBannedBots++;
                await twitchApi.ban(twitchApi.twitchBroadcasterChannel, userDetail.username);
                userDetail.isBanned = true;
            }
        }

        await this.trackUsersInChat(0, true);
        console.log(`Successfully updated ${numDeletedUsers} / ${knownUserIds.length} as recently deleted.`);
        console.log(`Successfully updated ${numOutdatedUsernames} / ${knownUserIds.length} outdated usernames.`);
        console.log(`Successfully flagged ${numUnbannedUsers} as unbanned.`);
        console.log(`Successfully synced ${numSyncedBans} active bans.`);
        console.log(`Successfully banned ${numBannedBots} known bots.`);
    }

    protected getHandler_Powerup(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            try {
                if (input.messageContainsGigantifiedEmote) {
                    if (input.userIsBroadcaster) { // Broadcasters Do not spend bits to redeem powerups on their own channel, so we should not add bits to the total
                        return;
                    }
                    const powerupGigantifyBitsCost = await this.getPowerupGigantifyBitsCost();
                    await this.trackUserBits2(input.userId, powerupGigantifyBitsCost);
                }
            } catch (err) {
                console.log(`Error tracking bits for user: ${input.userId}`);
                console.log(err);
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "powerup",
            triggerPhrases: undefined,
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }
}
