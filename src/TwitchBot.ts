import * as http from "http";
import * as https from "https";
import { getPassword, setPassword } from "keytar";
import * as open from "open";
import { WebSocket } from "ws";
import { ConsoleColors } from "./ConsoleColors";
import { Future } from "./Future";
import { IIrcBotAuxCommandGroupConfig, IJoinMessageDetail, IPartMessageDetail, IPrivMessageDetail, IrcBotBase } from "./IrcBot";
import { CreateCustomChannelPointRewardArgs, ITwitchBotAuxCommandConfig, ITwitchBotConfig, ITwitchBotConnectionConfig, ITwitchUserDetail, SubTierPoints, TwitchAppToken, TwitchBadgeTagKeys, TwitchBroadcasterSubscriptionsResponse, TwitchErrorResponse, TwitchEventSub_CreateSubscription, TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Event_SubscriptionEnd, TwitchEventSub_Event_SubscriptionGift, TwitchEventSub_Event_SubscriptionMessage, TwitchEventSub_Event_SubscriptionStart, TwitchEventSub_Notification_Payload, TwitchEventSub_Notification_Subscription, TwitchEventSub_Reconnect_Payload, TwitchEventSub_SubscriptionType, TwitchEventSub_Welcome_Payload, TwitchGetChannelInfo, TwitchGetChannelInfoResponse, TwitchGetCustomChannelPointRewardInfo, TwitchGetCustomChannelPointRewardResponse, TwitchGetStreamInfo, TwitchGetStreamsResponse, TwitchPrivMessageTagKeys, TwitchUserInfoResponse, TwitchUserToken } from "./TwitchBotTypes";
// import { randomInt } from "crypto";

export abstract class TwitchBotBase<TUserDetail extends ITwitchUserDetail = ITwitchUserDetail> extends IrcBotBase<TUserDetail> {
    public static readonly maxChatMessageLength = 500;
    protected static readonly _knownConfig: { encoding: "utf8" } = { encoding: "utf8" };

    public declare readonly _config: ITwitchBotConfig;
    protected readonly _userAccessToken = new Future<TwitchUserToken>();
    protected readonly _twitchAppToken = new Future<TwitchAppToken>();
    protected _twitchIdByUsername: { [key: string]: string } = {}
    protected _lastPendingChannelPointRewardByUserId: { [key: string]: { redemption_id: string, reward_id: string, broadcaster_id: string } } = {};
    protected readonly _userAccessTokenAccountName = "default"; // TODO: find a good replacement for this
    protected _twitchEventSub: WebSocket;
    protected _twitchEventSubHeartbeatInterval: NodeJS.Timer;
    protected _twitchEventSubTemp: WebSocket | undefined = undefined;

    protected _currentSubPoints?: number = undefined;
    protected _currentSubs?: number = undefined;

    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], configDir: string) {
        super(Object.assign(
            TwitchBotBase._knownConfig,
            { connection, auxCommandGroups, configDir }
        ));
    }

    /**
     * Twitch uses a separate userId that persists across usernames
     * @param username 
     * @returns 
     */
    protected override async getUserIdForUsername(username: string): Promise<string> {
        try {
            const userId = await this.getTwitchIdWithCache(username);
            return userId;
        } catch (err) {
            throw new Error(`Error receiving user id for username ${username} from twitch: ${err.message}`);
        }
    }

    protected override async callCommandFunctionFromConfig(command: ITwitchBotAuxCommandConfig, channel: string): Promise<boolean> {
        let streamDetails: TwitchGetChannelInfo | undefined = undefined;
        try {
            if (command.autoPostGameWhitelist) {
                streamDetails = streamDetails ?? await this.getChannelDetails(this.twitchChannelName); // TODO: parameterize this
                let gameInWhitelist = false;
                for (const gameName of command.autoPostGameWhitelist) {
                    if (streamDetails.game_name === gameName) {
                        gameInWhitelist = true;
                        break;
                    }
                }

                if (!gameInWhitelist) {
                    return false;
                }
            }

            if (command.autoPostIfTitleContainsAny) {
                streamDetails = streamDetails ?? await this.getChannelDetails(this.twitchChannelName); // TODO: parameterize this
                let substringMatchesInTitle = false;
                for (const substring of command.autoPostIfTitleContainsAny) {
                    if (streamDetails.title.includes(substring)) {
                        substringMatchesInTitle = true;
                        break;
                    }
                }

                if (!substringMatchesInTitle) {
                    return false;
                }
            }
        } catch (err) {
            this.onError(err);
            return false;
        }

        return await super.callCommandFunctionFromConfig(command, channel);
    }

    protected override async trackUsersInChat(secondsToAdd: number): Promise<void> {
        const isChannelLive = await this.isChannelLive(this.twitchChannelName);
        if (!isChannelLive) {
            return;
        }

        super.trackUsersInChat(secondsToAdd);
    }

    protected override async handleJoinMessage(messageDetail: IJoinMessageDetail): Promise<void> {
        super.handleJoinMessage(messageDetail);

        const userDetail = await this.getUserDetailWithCache(messageDetail.username);
        if (userDetail.username !== messageDetail.username) { // Locally stored username may not match because of a username change on Twitch
            if (userDetail.oldUsernames === undefined) {
                userDetail.oldUsernames = [];
            }
            userDetail.oldUsernames.push({ username: userDetail.username, lastSeenInChat: userDetail.lastSeenInChat ?? new Date() });
            
            userDetail.username = messageDetail.username;
        }
    }

    protected override async handlePartMessage(messageDetail: IPartMessageDetail): Promise<void> {
        super.handlePartMessage(messageDetail);
        
        // Delete the username-twitchId pair to ensure it is refreshed every time someone joins again
        delete this._twitchIdByUsername[messageDetail.username];
    }

    protected get twitchChannelName(): string {
        const twitchChannelName = this._config.connection.server.channel.slice(1, this._config.connection.server.channel.length); // strip the leading # from the IRC channel name
        return twitchChannelName;
    }

    protected async isChannelLive(channelName: string): Promise<boolean> {
        try {
            const channelInfoResponse = await this.getStreamDetails(channelName);
            const channelIsLive = channelInfoResponse.type === "live";
            return channelIsLive;
        } catch (err) {
            return false;
        }
    }

    protected async getChannelDetails(channelName: string): Promise<TwitchGetChannelInfo> {
        const broadcasterId = await this.getTwitchIdWithCache(channelName);

        const appToken = await this._twitchAppToken;
        return new Promise<TwitchGetChannelInfo>((resolve, reject) => {
    
            const options = {
                headers: {
                    Authorization: `Bearer ${appToken.access_token}`,
                    "client-id": `${this._config.connection.twitch.oauth.clientId}`,
                },
            };
            const request = https.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, options, (response) => {
                    response.on("data", (data) => {
                        const responseJson: TwitchGetChannelInfoResponse | TwitchErrorResponse = JSON.parse(data.toString("utf8"));
                        const errorResponse = responseJson as TwitchErrorResponse;
                        if (errorResponse.error) {
                            reject(`Error retrieving channel info from twitch API: ${errorResponse.status} ${errorResponse.error}: ${errorResponse.message}`);
                            return;
                        }

                        const channelInfoResponse = responseJson as TwitchGetChannelInfoResponse;
                        if (channelInfoResponse.data.length > 1) {
                            reject("More than one channel info received, expected only one.");
                            return;
                        }
                        if (channelInfoResponse.data.length === 0) {
                            reject("No channel info received in response, expected one.");
                            return;
                        }
                        resolve(channelInfoResponse.data[0]);
                        return;
                    });
                });
            request.on("error", (err) => {
                console.log("Error sending auth token request to twitch:");
                console.log(err);
                reject(err);
            });
        });
    }

    protected async getStreamDetails(channelName: string): Promise<TwitchGetStreamInfo> {
        const appToken = await this._twitchAppToken;
        return new Promise<TwitchGetStreamInfo>((resolve, reject) => {
    
            const options = {
                headers: {
                    Authorization: `Bearer ${appToken.access_token}`,
                    "client-id": `${this._config.connection.twitch.oauth.clientId}`,
                },
            };
            const request = https.get(`https://api.twitch.tv/helix/streams?user_login=${channelName}`, options, (response) => {
                    response.on("data", (data) => {
                        const responseJson: TwitchGetStreamsResponse | TwitchErrorResponse = JSON.parse(data.toString("utf8"));
                        const errorResponse = responseJson as TwitchErrorResponse;
                        if (errorResponse.error) {
                            reject(`Error retrieving channel info from twitch API: ${errorResponse.status} ${errorResponse.error}: ${errorResponse.message}`);
                            return;
                        }

                        const channelInfoResponse = responseJson as TwitchGetStreamsResponse;
                        if (channelInfoResponse.data.length > 1) {
                            reject("More than one stream info received, expected only one.");
                            return;
                        }
                        if (channelInfoResponse.data.length === 0) {
                            reject("No stream info received in response, expected one.");
                            return;
                        }
                        resolve(channelInfoResponse.data[0]);
                        return;
                    });
                });
            request.on("error", (err) => {
                console.log("Error sending auth token request to twitch:");
                console.log(err);
                reject(err);
            });
        });
    }

    protected async getTwitchIdWithCache(username?: string): Promise<string> {
        let id: string | undefined = username
            ? this._twitchIdByUsername[username]
            : (await this._userAccessToken).user_id;
        if (!id) {
            try {
                id = await this.getTwitchId(username);
            } catch (err) {
                throw new Error(`Error retrieving twitch user id: ${err}`);
            }

            if (username) {
                this._twitchIdByUsername[username] = id;
            } else {
                (await this._userAccessToken).user_id = id;
            }
        }
        
        return id;
    }

    /**
     * 
     * @param username Optional. if not provided, retrieves the twitch id for the active user access token
     * @returns 
     */
    protected async getTwitchId(username?: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            if (!username) {
                reject("Cannot retrieve user id for user access token unless token already exists!");
                return;
            }

            const options = {
                headers: {
                    Authorization: username
                        ? `Bearer ${(await this._twitchAppToken).access_token}`
                        : `Bearer ${(await this._userAccessToken).access_token}`,
                    "client-id": `${this._config.connection.twitch.oauth.clientId}`,
                },
            };
            const url = `https://api.twitch.tv/helix/users${username ? `?login=${username}` : ""}`;
            const request = https.get(url, options, (response) => {
                response.on("data", (data) => {
                    const responseJson: TwitchUserInfoResponse | TwitchErrorResponse = JSON.parse(data.toString("utf8"));
                    const errorResponse = responseJson as TwitchErrorResponse;
                    if (errorResponse.error) {
                        reject(`Error retrieving user info for username ${username} from twitch API: ${errorResponse.status} ${errorResponse.error}: ${errorResponse.message}`);
                        return;
                    }

                    const userInfoResponse = responseJson as TwitchUserInfoResponse;
                    const id = userInfoResponse.data[0]?.id;
                    if (id) {
                        resolve(id);
                        return;
                    }
                    reject(`Unable to parse user info from twitch API response: ${JSON.stringify(userInfoResponse)}`);
                });
            });
            request.on("error", (err) => {
                console.log("Error sending auth token request to twitch:");
                console.log(err);
                reject(err);
            });
        });
    }

    protected shouldIgnoreTimeoutRestrictions(messageDetail: IPrivMessageDetail): boolean {
        const tags = this.parseTwitchTags(messageDetail.tags);
        const badgeVersionsByBadgeName = this.parseTwitchBadges(tags.badges);
        if (badgeVersionsByBadgeName.broadcaster || badgeVersionsByBadgeName.moderator) {
            return true;
        }
        return false;
    }

    protected parseTwitchBadges(badges?: string): { [badgeName in TwitchBadgeTagKeys]: string } {
        if (!badges) {
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
            const badgeName = badgeSplit[0];
            const badgeVersion = badgeSplit[1];
            badgeVersionsByBadgeName[badgeName] = badgeVersion;
        }
        return badgeVersionsByBadgeName;
    }

    protected parseTwitchTags(tags?: string): { [key in TwitchPrivMessageTagKeys]: string } {
        if (!tags) {
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
            const key = splitTag[0];
            const value = splitTag[1];
            parsedTags[key] = value;
        }

        return parsedTags;
    }

    protected async loadAppAuthToken(): Promise<void> {
        console.log("Loading app auth token...");
        const promise = new Promise<void>((resolve, reject) => {
            const url = `https://id.twitch.tv/oauth2/token?client_id=${this._config.connection.twitch.oauth.clientId}&client_secret=${this._config.connection.twitch.oauth.clientSecret}&grant_type=client_credentials&scope=${this._config.connection.twitch.oauth.scope}`;
            const authRequest = https.request(url, {
                    method: "POST",
                    port: 443,
                },
                (response) => {
                    response.on("data", (data: Buffer) => {
                        const responseJson = JSON.parse(data.toString("utf8"));
                        if (responseJson.access_token) {
                            this._twitchAppToken.resolve(responseJson);
                            console.log("Successfully obtained app auth token from twitch.");
                            resolve();
                        } else {
                            const message = `Issue retrieving app auth token from twitch: ${responseJson}`
                            console.log(message);
                            reject(message);
                        }
                    });
                });

            authRequest.on("error", (err) => {
                console.log("Error sending app auth token request to twitch:");
                console.log(err);
                reject(err);
            });
            authRequest.end();
            // TODO: Setup token refresh
        });
        return promise;
    }

    protected abstract getServiceName(): string;

    protected async refreshUserToken(refreshToken: string): Promise<TwitchUserToken> {
        console.log(`Attempting to obtain user access token via refresh token...`);

        const tokenRequestBodyProps: { [key: string]: string } = {
            client_id: this._config.connection.twitch.oauth.clientId,
            client_secret: this._config.connection.twitch.oauth.clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        };
        const tokenRequestBody = Object.keys(tokenRequestBodyProps)
            .map(n => encodeURIComponent(n) + '=' + encodeURIComponent(tokenRequestBodyProps[n])).join('&');
        const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: tokenRequestBody,
        });
        const tokenResponseJson: any = await tokenResponse.json();
        console.log(`User access token successfully obtained via refresh token`);
        // console.log(tokenResponseJson); // TODO: log this at Trace level
        return tokenResponseJson;
    }

    protected storeUserTokenResponse(tokenResponse: TwitchUserToken, ): void {
        setPassword(this.getServiceName(), this._userAccessTokenAccountName, JSON.stringify(tokenResponse));
        this._userAccessToken.resolve(tokenResponse);
        console.log(`Successfully stored user token response`);
    }

    protected async loadUserToken(): Promise<void> {
        const clientId = this._config.connection.twitch.oauth.clientId;
        // Keep alphabetical for easier comparison against returned scope in refresh token
        const scope = `bits:read channel:manage:redemptions channel:read:subscriptions moderator:manage:banned_users`;

        const storedTokenString = await getPassword(this.getServiceName(), this._userAccessTokenAccountName);
        if (storedTokenString) {
            console.log(`Stored user access token found.`);
            // console.log(storedTokenString); // TODO: log this at Trace level
            const storedToken: TwitchUserToken = JSON.parse(storedTokenString);
            try {
                const refreshTokenResponse = await this.refreshUserToken(storedToken.refresh_token);
                if (refreshTokenResponse.scope.join(" ") !== scope) {
                    throw new Error(`Refresh token scope does not match requested scope (${scope} !== ${refreshTokenResponse.scope.join(" ")})`);
                }
                this.storeUserTokenResponse(refreshTokenResponse);
                return;
            } catch (err) {
                console.log(`Token Refresh failed: ${err}`);
            }
        }
        
        console.log(`Obtaining user access token from scratch...`);
        const redirectUrl = `http://localhost:3000`;
        const handleRequest = async (httpRequest: http.IncomingMessage, _httpResponse: http.ServerResponse) => {
            if (!httpRequest.url) {
                return;
            }
            console.log(`Incoming Request: ${httpRequest.url}`);
            const incomingUrl = new URL(`${redirectUrl}${httpRequest.url}`);
            const authCode = incomingUrl.searchParams.get("code");
            if (!authCode) {
                throw new Error(`Could not load user token: no auth code returned`);
            }

            const tokenRequestBodyProps: { [key: string]: string } = {
                client_id: this._config.connection.twitch.oauth.clientId,
                client_secret: this._config.connection.twitch.oauth.clientSecret,
                code: authCode,
                grant_type: "authorization_code",
                redirect_uri: redirectUrl,
            }
            const tokenRequestBody = Object.keys(tokenRequestBodyProps)
                .map(n => encodeURIComponent(n) + '=' + encodeURIComponent(tokenRequestBodyProps[n])).join('&');
            const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: tokenRequestBody,
            });
            const tokenResponseJson: any = await tokenResponse.json();
            if (tokenResponse.status !== 200) {
                const errMessage = `Failed to exchange authorization code for access token: ${tokenResponse.status}`;
                console.log(errMessage);
                console.log(tokenResponseJson);
                throw new Error(errMessage);
            }
            this.storeUserTokenResponse(tokenResponseJson);
        };
        const server = http.createServer(handleRequest);
        server.listen(new URL(redirectUrl).port);

        const redirect_uri = redirectUrl;
        const url = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirect_uri}&response_type=code&scope=${scope}`;
        await open(url);
    }

    public override async _startup(): Promise<void> {
        await super._startup();

        await this.loadAppAuthToken();
        await this.loadUserToken();

        const existingSubscriptions = await this.getEventSubSubscriptions();
        await this.deleteUnusedEventSubSubscriptions(existingSubscriptions);

        this._twitchEventSub = this.createTwitchEventSubWebsocket("wss://eventsub.wss.twitch.tv/ws");

        this.sendRaw("CAP REQ :twitch.tv/membership"); // Request capability to receive JOIN and PART events from users connecting to channels
        this.sendRaw("CAP REQ :twitch.tv/commands"); // Request capability to send & receive twitch-specific commands (timeouts, chat clears, host notifications, subscriptions, etc.)
        this.sendRaw("CAP REQ :twitch.tv/tags"); // Request capability to augment certain IRC messages with tag metadata

        const subDetail = await this.getActiveBroadcasterSubcriptions();
        this.updateSubscribedUsers(subDetail);
        this._currentSubs = subDetail.total;
        this._currentSubPoints = subDetail.points;
    }

    protected abstract getTwitchBroadcasterId(): Promise<string>;

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
            this._twitchEventSub.close();
            this._twitchEventSub = this._twitchEventSubTemp;
            this._twitchEventSubTemp = undefined;
            console.log(`  ${ConsoleColors.FgYellow}Reconnected to new EventSub websocket!${ConsoleColors.Reset}\n`);
            return;
        }

        let numAttemptedSubscriptions = 0;
        let numNewSubscriptions = 0;
        for (const topic of await this.getTwitchEventSubTopics()) { // Cannot send arrays of subscriptions, must do one by one
            numAttemptedSubscriptions++;
            const body: TwitchEventSub_CreateSubscription = {
                type: topic.name,
                version: topic.version,
                condition: topic.condition,
                transport: {
                    method: "websocket",
                    session_id: payload.session.id,
                }
            };
            // Websockets are read-only (aside from PONG responses), so subscriptions are set up via HTTP instead (just like webhooks)
            const subscriptionResponse = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions`, {
                method: `POST`,
                headers: {
                    Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                    "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                    "Content-Type": `application/json`,
                },
                body: JSON.stringify(body),
            });
            if (subscriptionResponse.status === 202) {
                numNewSubscriptions++;
            }
        }
        console.log(`  ${ConsoleColors.FgYellow}Subscribed to ${numNewSubscriptions}/${numAttemptedSubscriptions} EventSub Topics!${ConsoleColors.Reset}\n`);
    }

    protected async handleEventSubReconnect(payload: TwitchEventSub_Reconnect_Payload): Promise<void> {
        this._twitchEventSubTemp = this.createTwitchEventSubWebsocket(payload.session.reconnect_url);
    }

    protected async handleEventSubNotification(notificationMessage: TwitchEventSub_Notification_Payload): Promise<void> {
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

        } else if (notificationMessage.subscription.type === "channel.follow") {

        } else if (notificationMessage.subscription.type === "channel.ad_break.begin") {

        }
    }

    protected abstract handleChannelPointRewardRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, subscription: TwitchEventSub_Notification_Subscription): Promise<void>;

    protected async handleSubscriptionStart(event: TwitchEventSub_Event_SubscriptionStart, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        if (!this._currentSubPoints || !this._currentSubs)
            return;

        this._currentSubPoints += SubTierPoints.getPointsByTier(event.tier);
        this._currentSubs += 1;
    }

    protected async handleSubscriptionEnd(event: TwitchEventSub_Event_SubscriptionEnd, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        if (!this._currentSubPoints || !this._currentSubs)
            return;

        this._currentSubPoints -= SubTierPoints.getPointsByTier(event.tier);
        this._currentSubs -= 1;
    }

    protected async handleSubscriptionMessage(event: TwitchEventSub_Event_SubscriptionMessage, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        const userDetail = await this.getUserDetailWithCache(event.user_login);
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

    protected abstract handleSubscriptionGift(event: TwitchEventSub_Event_SubscriptionGift, _subscription: TwitchEventSub_Notification_Subscription): Promise<void>;

    protected abstract handleCheer(event: TwitchEventSub_Event_Cheer, _subscription: TwitchEventSub_Notification_Subscription): Promise<void>;

    protected async getEventSubSubscriptions(): Promise<any[]> {
        const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
        });
        const json = await response.json();
        console.log(`  ${ConsoleColors.FgYellow}Current number of EventSub Subscriptions: ${json.total}${ConsoleColors.Reset}\n`);
        return json.data;
    }

    protected async deleteUnusedEventSubSubscriptions(subs: any[]): Promise<void> {
        let numDeleted = 0;
        for (const sub of subs) {
            if (sub.status === "websocket_failed_ping_pong" || "websocket_disconnected") {
                const deleteResponse = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`, {
                    method: `DELETE`,
                    headers: {
                        Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                        "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                        "Content-Type": `application/json`,
                    },
                });
                if (deleteResponse.status === 204) {
                    numDeleted++;
                }
            }
        }
        console.log(`  ${ConsoleColors.FgYellow}Deleted ${numDeleted} useless subscriptions${ConsoleColors.Reset}\n`);
    }

    protected async getActiveBroadcasterSubcriptions(): Promise<TwitchBroadcasterSubscriptionsResponse> {
        // TODO: fetch more than 100 subs via paging
        const broadcasterId = await this.getTwitchBroadcasterId();
        const response = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}&first=100`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
            },
        });
        const json: TwitchBroadcasterSubscriptionsResponse = await response.json();
        console.log(`  ${ConsoleColors.FgYellow}Current number of subs/subpoints: ${json.total}/${json.points}${ConsoleColors.Reset}\n`);
        return json;
    }

    protected async updateSubscribedUsers(subDetail: TwitchBroadcasterSubscriptionsResponse): Promise<void> {
        for (const sub of subDetail.data) {
            const userDetail = await this.getUserDetailWithCache(sub.user_login);
            userDetail.subscriptionTier = sub.tier;
            userDetail.lastKnownSubscribedDate = new Date();

            if (!userDetail.firstKnownSubscribedDate) {
                userDetail.firstKnownSubscribedDate = new Date(userDetail.lastKnownSubscribedDate);
            }
        }
    }

    public async timeout(channelUsername: string, usernameToTimeout: string, durationSeconds: number): Promise<void> {
        const userAccessToken = await this._userAccessToken;

        console.log(`Timing out ${usernameToTimeout} in channel ${channelUsername}`)
        const broadcasterId = await this.getTwitchIdWithCache(channelUsername.replace("#", ""));
        const chatbotId = await this.getTwitchIdWithCache(this._config.connection.user.nick);
        const userIdToBan = await this.getTwitchIdWithCache(usernameToTimeout);
        const body = {
            data: {
                user_id: userIdToBan,
                duration: durationSeconds,
            }
        }

        const response = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${chatbotId}`, {
            method: `POST`,
            headers: {
                Authorization: `Bearer ${userAccessToken.access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(body),
        });
        const timeoutResponse: any = await response.json();
        if (timeoutResponse.status !== 200) {
            console.log(`Timeout request failed: ${response.status} ${response.statusText}`);
            console.log(timeoutResponse);
        } else {
            console.log(`Timeout Successful.`);
        }
    }

    public clearTimeout(channel: string, username: string): void {
        this.timeout(channel, username, 1);
    }

    public override chat(recipient: string, message: string): void {
        let actualMessage = message;
        if (message.length > TwitchBotBase.maxChatMessageLength) {
            actualMessage = "<Message was too long. Please file a bug report with the owner :)>"; // TODO: include first few words of attempted message
            console.log(`Message too long for Twitch: ${message}`);
        }
        super.chat(recipient, actualMessage);
    }

    public async getChannelPointRewards(): Promise<TwitchGetCustomChannelPointRewardInfo[]> {
        const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${await this.getTwitchBroadcasterId()}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
        });
        if (response.status === 200) {
            const json: TwitchGetCustomChannelPointRewardResponse = await response.json();
            return json.data;
        }

        throw new Error(`Unable to retrieve channel point rewards: ${response.status} error (${(await response.json()).message})`);
    }

    public async createChannelPointReward(body: CreateCustomChannelPointRewardArgs): Promise<void> {
        const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${await this.getTwitchBroadcasterId()}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(body),
        });
        if (response.status === 200) {
            return;
        }

        throw new Error(`Unable to create new channel point reward: ${response.status} error (${(await response.json()).message})`);
    }

    public async updateChannelPointRedemption(redemption_id: string, reward_id: string, broadcaster_id: string, fulfill?: boolean): Promise<void> {
        const body = {
            status: fulfill ? "FULFILLED" : "CANCELED",
        };
        const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${broadcaster_id}&reward_id=${reward_id}&id=${redemption_id}`, {
            method: `PATCH`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(body),
        });
        if (response.status === 200) {
            return;
            // const json: TwitchUpdateChannelPointRedemptionStatusResponse = await response.json();
        }

        throw new Error(`Unable to update redemption status: ${response.status} error (${(await response.json()).message})`);
    }

    public async holdLastChannelPointReward(redemption_id: string, reward_id: string, broadcaster_id: string, user_id: string): Promise<void> {
        await this.tryUpdateHeldChannelPointReward(user_id, false); // automatically reject the other pending promise if there is one 
        this._lastPendingChannelPointRewardByUserId[user_id] = { redemption_id, reward_id, broadcaster_id };
    }

    public async tryUpdateHeldChannelPointReward(user_id: string, fulfill?: boolean): Promise<void> {
        const existingEntry = this._lastPendingChannelPointRewardByUserId[user_id];
        if (existingEntry) {
            await this.updateChannelPointRedemption(existingEntry.redemption_id, existingEntry.reward_id, existingEntry.broadcaster_id, fulfill);
        }
    }
}
