import * as http from "http";
import * as https from "https";
import { getPassword, setPassword } from "keytar";
import * as open from "open";
import { WebSocket } from "ws";
import { ConsoleColors } from "./ConsoleColors";
import { Future } from "./Future";
import { HeldTaskGroup } from "./HeldTask";
import { IIrcBotAuxCommandGroupConfig, IIrcBotMiscConfig, IJoinMessageDetail, IPartMessageDetail, IPrivMessageDetail, IrcBotBase } from "./IrcBot";
import { TaskQueue } from "./TaskQueue";
import { CreateCustomChannelPointRewardArgs, ITwitchBotAuxCommandConfig, ITwitchBotConfig, ITwitchBotConnectionConfig, SubTierPoints, TwitchAppToken, TwitchBadgeTagKeys, TwitchBannedUser, TwitchBroadcasterSubscriptionsResponse, TwitchChatSettings, TwitchErrorResponse, TwitchEventSub_CreateSubscription, TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Event_Follow, TwitchEventSub_Event_Raid, TwitchEventSub_Event_SubscriptionEnd, TwitchEventSub_Event_SubscriptionGift, TwitchEventSub_Event_SubscriptionMessage, TwitchEventSub_Event_SubscriptionStart, TwitchEventSub_Notification_Payload, TwitchEventSub_Notification_Subscription, TwitchEventSub_Reconnect_Payload, TwitchEventSub_SubscriptionType, TwitchEventSub_Welcome_Payload, TwitchFollowingUser, TwitchGame, TwitchGetBannedUsersResponseBody, TwitchGetChannelInfo, TwitchGetChannelInfoResponse, TwitchGetCustomChannelPointRewardInfo, TwitchGetCustomChannelPointRewardResponse, TwitchGetFollowingUsersResponseBody, TwitchGetGamesResponseBody, TwitchGetShieldModeStatusResponseBody, TwitchGetStreamInfo, TwitchGetStreamsResponse, TwitchPrivMessageTagKeys, TwitchSubscriptionDetail, TwitchUpdateChannelInformationRequestBody, TwitchUpdateChatSettingsRequestBody, TwitchUserAPIInfo, TwitchUserDetail, TwitchUserInfoResponse, TwitchUserToken } from "./TwitchBotTypes";
import { knownBots } from "./KnownBots";

export abstract class TwitchBotBase<TUserDetail extends TwitchUserDetail = TwitchUserDetail> extends IrcBotBase<TUserDetail> {
    public static readonly twitchMaxChatMessageLength = 500;
    protected static readonly _knownConfig: { encoding: "utf8" } = { encoding: "utf8" };

    public declare readonly _config: ITwitchBotConfig;
    protected readonly _userAccessToken = new Future<TwitchUserToken>();
    protected readonly _twitchAppToken = new Future<TwitchAppToken>();
    protected readonly _userAccessTokenAccountName = "default"; // TODO: find a good replacement for this
    protected _twitchEventSub: WebSocket;
    protected _twitchEventSubHeartbeatInterval: NodeJS.Timer;
    protected _twitchEventSubTemp: WebSocket | undefined = undefined;
    public readonly heldTasksByUserId: HeldTaskGroup = new HeldTaskGroup();

    protected _raidResponseTaskQueue = new TaskQueue();
    protected _chatSettingsPriorToRaidOverride?: TwitchChatSettings;
    protected _raidOverrideTimeouts?: { warning: NodeJS.Timeout, final: NodeJS.Timeout };

    protected _currentSubPoints?: number = undefined;
    protected _currentSubCount?: number = undefined;

    protected override get maxChatMessageLength(): number {
        return this._config.misc.maxChatMessageLength ?? TwitchBotBase.twitchMaxChatMessageLength;
    }

    public abstract get powerupGigantifyBitsCost(): number; // TODO: track every type of powerup

    public constructor(miscConfig: IIrcBotMiscConfig, connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], configDir: string) {
        super(Object.assign(
            TwitchBotBase._knownConfig,
            { connection, auxCommandGroups, configDir, misc: miscConfig }
        ));

        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleMessagePowerup(detail));
    }

    protected isValidTwitchUserLogin(username: string): boolean {
        const regex = /^[a-zA-Z0-9_]{4,25}$/;
        return regex.test(username);
    }

    protected override async getUserIdsForUsernames(usernames: string[]): Promise<{ [username: string]: string | undefined }> {
        const userIdsByUsername: { [username: string]: string | undefined } = {}
        const usernamesByUserLogin: { [userLogin: string]: string[] | undefined } = {};
        const usernamesToQuery: string[] = [];

        for (const username of usernames) {
            userIdsByUsername[username] = undefined;
            if (this.isValidTwitchUserLogin(username)) {
                const userLogin = username.toLowerCase();
                if (usernamesByUserLogin[userLogin] === undefined) {
                    usernamesByUserLogin[userLogin] = [];
                }
                usernamesByUserLogin[userLogin]!.push(username);
                usernamesToQuery.push(userLogin);
            } else {
                console.log(`Cannot retrieve user info for invalid username: ${username}`);
            }
        }

        const userApiInfoByUserId = await this.getUserApiInfo([], usernamesToQuery);
        for (const userIdKey in userApiInfoByUserId) {
            const userApiInfo = userApiInfoByUserId[userIdKey];
            if (userApiInfo) {
                const usernamesForUserLogin = usernamesByUserLogin[userApiInfo.login];
                if (usernamesForUserLogin === undefined) {
                    continue;
                }
                for (const username of usernamesForUserLogin) {
                    userIdsByUsername[username] = userApiInfo.id;
                }
            }
        }

        return userIdsByUsername;
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

    protected override async trackUsersInChat(secondsToAdd: number, force: boolean = false): Promise<void> {
        const isChannelLive = await this.isChannelLive(this.twitchChannelName);
        if (!force && !isChannelLive) {
            return;
        }

        super.trackUsersInChat(secondsToAdd);
    }

    protected updateUsername(userDetail: TUserDetail, newUsername: string): void {
        if (userDetail.oldUsernames === undefined) {
            userDetail.oldUsernames = [];
        }
        userDetail.oldUsernames.push({ username: userDetail.username, lastSeenInChat: userDetail.lastSeenInChat ?? new Date() });
        
        userDetail.username = newUsername;
    }

    protected override async handleJoinMessage(messageDetail: IJoinMessageDetail): Promise<void> {
        super.handleJoinMessage(messageDetail);

        let userDetail: TUserDetail | undefined;
        try {
            userDetail = await this.getUserDetailWithCache(messageDetail.username);
        } catch (err) {
            console.log(`Error retrieving userDetail for user: ${messageDetail.username}`);
            console.log(err);
            return;
        }

        if (userDetail.username !== messageDetail.username) { // Locally stored username may not match because of a username change on Twitch
            this.updateUsername(userDetail, messageDetail.username);
        }
    }

    protected override async handlePartMessage(messageDetail: IPartMessageDetail): Promise<void> {
        super.handlePartMessage(messageDetail);
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
        const broadcasterId = await this.getUserIdForUsername(channelName);

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

    /**
     * 
     * @param userLogin If undefined, this function returns retrieves the twitch id for the active user access token
     * @returns 
     */
    protected async getUserApiInfoSingle(userLogin?: string): Promise<TwitchUserAPIInfo | undefined> {
        if (!userLogin) {
            return this._getUserApiInfoFromToken();
        }

        const userInfoDict = await this.getUserApiInfo([], [userLogin]);
        const keys = Object.keys(userInfoDict);
        if (keys.length === 0) {
            throw new Error(`Error retrieving API info for username: ${userLogin}`);
        }
        const userInfo = userInfoDict[keys[0]];
        return userInfo;
    }

    protected async _getUserApiInfoFromToken(): Promise<TwitchUserAPIInfo> {
        const response = await fetch(`https://api.twitch.tv/helix/users`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
            }
        });

        if (response.status !== 200) {
            const errMessage = `Get Users (from token) request failed: ${response.status} ${response.statusText}`;
            console.log(errMessage);
            console.log(await response.json());
            throw new Error(errMessage);
        } else {
            // console.log(`Get Users request successful.`);
        }

        const json: TwitchUserInfoResponse = await response.json();
        const userApiInfoArray = json.data;
        if (userApiInfoArray.length !== 1) {
            const errMessage = `Expected 1 user info object in response which represents the provided accessToken`;
            console.log(errMessage);
            console.log(await response.json());
            throw new Error(errMessage);
        }

        return userApiInfoArray[0];
    }

    protected async getUserApiInfo(userIds: string[], userLogins: string[]): Promise<{ [userId: string]: TwitchUserAPIInfo | undefined }> {
        const returnVal: { [userId: string]: TwitchUserAPIInfo | undefined } = {};
        let numUserIdsQueried = 0;
        let numUserLoginsQueried = 0;
        let numEntriesFound = 0;
        const totalUsersToQuery = userIds.length + userLogins.length;
        const pageSize = 100;

        while (numUserIdsQueried + numUserLoginsQueried < totalUsersToQuery) {
            const userIdsInPage = userIds.slice(numUserIdsQueried, numUserIdsQueried + pageSize);
            const userLoginsInPage = userIdsInPage.length < pageSize
                ? userLogins.slice(numUserLoginsQueried, numUserLoginsQueried + (pageSize - userIdsInPage.length))
                : [];

            const idQueryParams = userIdsInPage.map(n => `id=${n}`);
            const loginQueryParams = userLoginsInPage.map(n => `login=${n}`);
            const queryParams = [...idQueryParams, ...loginQueryParams].join(`&`);
            const url = `https://api.twitch.tv/helix/users?${queryParams}`;

            const response = await fetch(url, {
                method: `GET`,
                headers: {
                    Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                    "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                }
            });

            if (response.status !== 200) {
                const errMessage = `Get Users request failed: ${response.status} ${response.statusText}`;
                console.log(errMessage);
                console.log(await response.json());
                console.log(`URL: ${url}`);
                throw new Error(errMessage);
            } else {
                // console.log(`Get Users request successful.`);
            }

            const json: TwitchUserInfoResponse = await response.json();

            const userApiInfoArray = json.data;
            for (const userApiInfo of userApiInfoArray) {
                returnVal[userApiInfo.id] = userApiInfo;
            }

            numUserIdsQueried += userIdsInPage.length;
            numUserLoginsQueried += userLoginsInPage.length;
            numEntriesFound += userApiInfoArray.length;
        }

        const totalUsersQueried = numUserIdsQueried + numUserLoginsQueried;
        console.log(`Found info for ${numEntriesFound} / ${totalUsersQueried} queried users (${numUserIdsQueried} ids + ${numUserLoginsQueried} logins)`);
        return returnVal;
    }

    protected shouldIgnoreTimeoutRestrictions(messageDetail: IPrivMessageDetail): boolean {
        const tags = this.parseTwitchMessageTags(messageDetail.tags);
        const badgeVersionsByBadgeName = this.parseTwitchMessageBadges(tags.badges);
        if (badgeVersionsByBadgeName.broadcaster || badgeVersionsByBadgeName.moderator) { // TODO: do this entirely using tags
            return true;
        }
        return false;
    }

    protected emoteWasGigantified(messageDetail: IPrivMessageDetail): boolean {
        const tags = this.parseTwitchMessageTags(messageDetail.tags);
        return tags["msg-id"] === "gigantified-emote-message";
    }

    protected parseTwitchMessageBadges(badges?: string): { [badgeName in TwitchBadgeTagKeys]: string } {
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

    protected parseTwitchMessageTags(tags?: string): { [key in TwitchPrivMessageTagKeys]: string } {
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

    protected storeUserTokenResponse(tokenResponse: TwitchUserToken): void {
        setPassword(this.getServiceName(), this._userAccessTokenAccountName, JSON.stringify(tokenResponse));
        this._userAccessToken.resolve(tokenResponse);
        console.log(`Successfully stored user token response`);
    }

    protected async loadUserToken(): Promise<void> {
        const clientId = this._config.connection.twitch.oauth.clientId;
        // Keep alphabetical for easier comparison against returned scope in refresh token
        const scope = `bits:read channel:manage:broadcast channel:manage:redemptions channel:read:subscriptions moderator:manage:banned_users moderator:manage:chat_settings moderator:manage:shield_mode moderator:read:followers user:read:follows`;

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
        const url = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirect_uri}&response_type=code&scope=${scope}&force_verify=true`;
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

        const activeSubInfo = await this.getActiveBroadcasterSubcriptions();
        this.updateSubscribedUsers(activeSubInfo.subDetails);
        this._currentSubCount = activeSubInfo.subCount;
        this._currentSubPoints = activeSubInfo.subPoints;
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
            } else {
                console.log(`Error subscribing to specific EventSub (${subscriptionResponse.status} response):`);
                console.log(topic);
                console.log(await subscriptionResponse.json());
            }
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
            userDetail = await this.getUserDetailWithCache(event.user_login);
        } catch (err) {
            console.log(`Error retrieving userDetail for user: ${event.user_login}`);
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

    protected async trackUserBits(userLogin: string, numBits: number) {
        let userDetail: TUserDetail | undefined;
        try {
            userDetail = await this.getUserDetailWithCache(userLogin);
        } catch (err) {
            console.log(`Error retrieving userDetail for user: ${userLogin}`);
            console.log(err);
            return;
        }

        userDetail.numBitsCheered = userDetail.numBitsCheered === undefined
            ? numBits
            : userDetail.numBitsCheered + numBits
    }

    protected async handleCheer(event: TwitchEventSub_Event_Cheer, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        if (event.is_anonymous || !event.user_login) {
            return;
        }

        await this.trackUserBits(event.user_login, event.bits);
    }

    protected async handleMessagePowerup(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            if (this.emoteWasGigantified(messageDetail)) {
                const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
                if (userIsBroadcaster) { // Broadcasters Do not spend bits to redeem powerups on their own channel, so we should not add bits to the total
                    return;
                }

                await this.trackUserBits(messageDetail.username, this.powerupGigantifyBitsCost);
            }
        }

        await messageHandler(messageDetail);
    }

    protected async isShieldModeEnabled(): Promise<boolean> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const response = await fetch(`https://api.twitch.tv/helix/moderation/shield_mode?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
            }
        });

        if (response.status !== 200) {
            console.log(`Get Shield Mode request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Get Shield Mode request successful.`);
        }

        const json: TwitchGetShieldModeStatusResponseBody = await response.json();
        return json.data[0].is_active;
    }

    protected async updateShieldMode(enable: boolean): Promise<void> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const body = {
            is_active: enable,
        };
        const response = await fetch(`https://api.twitch.tv/helix/moderation/shield_mode?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
            method: `PUT`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
            },
            body: JSON.stringify(body),
        });

        if (response.status !== 200) {
            console.log(`Update Shield Mode request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Update Shield Mode request successful.`);
        }
        return;
    }

    protected async getChatSettings(): Promise<TwitchChatSettings> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const response = await fetch(`https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
            }
        });

        if (response.status !== 200) {
            console.log(`Get Chat Settings request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Get Chat Settings request successful.`);
        }

        const getChatSettingsJson = await response.json();
        return getChatSettingsJson.data[0];
    }

    protected async updateChatSettings(settings: TwitchUpdateChatSettingsRequestBody): Promise<void> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const response = await fetch(`https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
            method: `PATCH`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(settings),
        });

        if (response.status !== 200) {
            console.log(`Update Chat Settings request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Update Chat Settings request successful.`);
        }

        return;
    }

    protected setChatSettingsOverrideTimeouts(overrideMillis: number, warningMillis: number, chatRespondTo: string): void {
        const finalTimeout = setTimeout(async () => {
            if (this._chatSettingsPriorToRaidOverride === undefined) { // settings have already been reverted
                return;
            }
            await this.updateChatSettings(this._chatSettingsPriorToRaidOverride);
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
        const shieldModeEnabled: boolean = await this.isShieldModeEnabled();
        if (shieldModeEnabled) { // Do not interfere at all if shield mode is enabled, because editing settings will edit shield mode
            future.resolve();
            return;
        }

        const chatRespondTo = `#${broadcasterLogin}`;
        
        const currentChatSettings = await this.getChatSettings();
        const originalChatSettings = this._chatSettingsPriorToRaidOverride ?? currentChatSettings;

        const overrideMinutes = originalChatSettings.follower_mode_duration * 2;
        const warningMinutes = originalChatSettings.follower_mode_duration - 3;
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
            await this.updateChatSettings({
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
        const raidingChannelDetails = await this.getChannelDetails(event.from_broadcaster_user_login);
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
            userDetail = await this.getUserDetailWithCache(event.user_login);
        } catch (err) {
            console.log(`Error retrieving userDetail for user: ${event.user_login}`);
            console.log(err);
            return;
        }

        userDetail.isFollower = true;
        if (!userDetail.followDates) {
            userDetail.followDates = [];
        }
        userDetail.followDates.push(new Date(event.followed_at));
    }

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
        for (const sub of subs) { // TODO: fix subs not iterable error
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

    protected async getActiveBroadcasterSubcriptions(): Promise<{ subPoints: number, subCount: number, subDetails: TwitchSubscriptionDetail[] }> {
        // TODO: fetch more than 100 subs via paging
        const broadcasterId = await this.getTwitchBroadcasterId();
        const subscribedUsers: TwitchSubscriptionDetail[] = [];

        let cursor: string | undefined = undefined;
        const pageSize = 100;
        let subPoints = 0;
        let subCount = 0;
        
        while (true) {
            const response = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}&first=${pageSize}${!!cursor ? `&after=${cursor}` : ``}`, {
                method: `GET`,
                headers: {
                    Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                    "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                },
            });
    
            if (response.status !== 200) {
                console.log(`Get Active Broadcaster Subscriptions request failed: ${response.status} ${response.statusText}`);
                const json = await response.json();
                console.log(json);
                throw new Error("Get Active Broadcaster Subscriptions request failed");
            }
    
            const json: TwitchBroadcasterSubscriptionsResponse = await response.json();
            subscribedUsers.push(...json.data);

            if (!json.pagination.cursor) {
                break;
            }
            subPoints = json.points;
            subCount = json.total;
            cursor = json.pagination.cursor;
        }
        
        console.log(`  ${ConsoleColors.FgYellow}Current number of subs/subpoints: ${subCount}/${subPoints}${ConsoleColors.Reset}\n`);
        return {
            subCount,
            subPoints,
            subDetails: subscribedUsers,
        }
    }

    protected async updateSubscribedUsers(subDetails: TwitchSubscriptionDetail[]): Promise<void> {
        const subscribedUserLogins = subDetails.map(n => n.user_login);
        const userDetailPromisesByUsername = this.getUserDetailsWithCache(subscribedUserLogins);

        for (const sub of subDetails) {
            let userDetail: TUserDetail | undefined;
            try {
                userDetail = await userDetailPromisesByUsername[sub.user_login];
            } catch (err) {
                console.log(`Error updating subscribed user: ${sub.user_login}`);
                console.log(err);
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

    public async ban(channelUsername: string, usernameToBan: string): Promise<void> {
        const userAccessToken = await this._userAccessToken;

        console.log(`Banning ${usernameToBan} in channel #${channelUsername}`);
        const broadcasterId = await this.getUserIdForUsername(channelUsername);
        const userIdToBan = await this.getUserIdForUsername(usernameToBan);
        const body = {
            data: {
                user_id: userIdToBan,
            }
        }

        const response = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, { // TODO: sign in with the chatbot account for this
            method: `POST`,
            headers: {
                Authorization: `Bearer ${userAccessToken.access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(body),
        });

        if (response.status !== 200) {
            const badResponseJson: any = await response.json();
            console.log(`Ban request failed: ${response.status} ${response.statusText}`);
            console.log(badResponseJson);
        } else {
            console.log(`Ban against ${usernameToBan} (id: ${userIdToBan}) Successful.`);
        }
    }

    public async timeout(channelUsername: string, usernameToTimeout: string, durationSeconds: number): Promise<void> {
        const userAccessToken = await this._userAccessToken;

        console.log(`Timing out ${usernameToTimeout} in channel ${channelUsername}`)
        const broadcasterId = await this.getUserIdForUsername(channelUsername);
        const userIdToBan = await this.getUserIdForUsername(usernameToTimeout);
        const body = {
            data: {
                user_id: userIdToBan,
                duration: durationSeconds,
            }
        }

        const response = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, { // TODO: sign in with the chatbot account for this
            method: `POST`,
            headers: {
                Authorization: `Bearer ${userAccessToken.access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(body),
        });
        if (response.status !== 200) {
            const badResponseJson: any = await response.json();
            console.log(`Timeout request failed: ${response.status} ${response.statusText}`);
            console.log(badResponseJson);
        } else {
            console.log(`Timeout Successful.`);
        }
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

    protected async getBannedUsers(): Promise<TwitchBannedUser[]> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const bannedUsers: TwitchBannedUser[] = [];

        let cursor: string | undefined = undefined
        const pageSize = 100;

        while (true) {
            const response = await fetch(`https://api.twitch.tv/helix/moderation/banned?broadcaster_id=${broadcasterId}&first=${pageSize}${!!cursor ? `&after=${cursor}` : ``}`, {
                method: `GET`,
                headers: {
                    Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                    "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                }
            });
    
            if (response.status !== 200) {
                console.log(`Get Banned Users request failed: ${response.status} ${response.statusText}`);
                console.log(await response.json());
                throw new Error("Get Banned Users request failed");
            }
    
            const json: TwitchGetBannedUsersResponseBody = await response.json();
            bannedUsers.push(...json.data);

            if (!json.pagination.cursor) {
                break;
            }
            cursor = json.pagination.cursor;
        }

        console.log(`Get Banned Users successful (${bannedUsers.length} users)`);
        return bannedUsers;
    }

    protected async getFollowers(): Promise<TwitchFollowingUser[]> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const followingUsers: TwitchFollowingUser[] = [];
        let cursor: string | undefined = undefined

        while (true) {
            const response = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=${100}${!!cursor ? `&after=${cursor}` : ``}`, {
                method: `GET`,
                headers: {
                    Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                    "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                }
            });
    
            if (response.status !== 200) {
                console.log(`Get Following Users request failed: ${response.status} ${response.statusText}`);
                const json = await response.json();
                console.log(json);
                throw new Error("Get Following Users request failed");
            }
    
            const json: TwitchGetFollowingUsersResponseBody = await response.json();
            followingUsers.push(...json.data);

            if (!json.pagination.cursor) {
                break;
            }
            cursor = json.pagination.cursor;
        }

        console.log(`Get Following Users successful (${followingUsers.length} users)`);
        return followingUsers;
    }

    protected async updateFollowers(): Promise<void> {
        const followingUsers = await this.getFollowers();
        const userDetailPromisesByUsername = this.getUserDetailsWithCache(followingUsers.map(n => n.user_login));

        for (const followingUser of followingUsers) {
            let userDetail: TUserDetail | undefined;
            try {
                userDetail = await userDetailPromisesByUsername[followingUser.user_login];
            } catch (err) {
                console.log(`Error updating subscribed user: ${followingUser.user_login}`);
                console.log(err);
                continue;
            }

            userDetail.isFollower = true;
            if (userDetail.followDates === undefined) {
                userDetail.followDates = [];
            }
            userDetail.followDates.push(new Date(followingUser.followed_at));
        }

        // Flag all non-followers
        const knownUserIds = Object.keys(this._userDetailByUserId);
        for (const userId of knownUserIds) {
            const detail = this._userDetailByUserId[userId];
            if (!followingUsers.some(n => n.user_id === detail.id)) { // TODO: optimize this (merge the list of userIds and iterate once, perhaps?)
                detail.isFollower = false;
            }
        }
    }

    protected async updateAllUsers(): Promise<void> {
        await this.updateFollowers();

        const userIds = Object.keys(this._userDetailByUserId);
        const userApiInfoByUserId = await this.getUserApiInfo(userIds, []);
        let numDeletedUsers = 0;
        let numOutdatedUsernames = 0;
        let numBannedBots = 0;
        let numSyncedBans = 0;
        let numUnbannedUsers = 0;

        const bannedUsers = await this.getBannedUsers();

        for (const userId in userApiInfoByUserId) {
            const userDetail = this._userDetailByUserId[userId];
            const userApiInfo = userApiInfoByUserId[userId];

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
            }

            if (!userDetail.isBanned && userInBannedList) {
                numSyncedBans++;
                userDetail.isBanned = true;
            }

            const userIsABot = knownBots.some(n => n === userDetail.username);
            if (userIsABot && userDetail.isBanned !== true) {
                numBannedBots++;
                await this.ban(this.twitchChannelName, userDetail.username);
                userDetail.isBanned = true;
            }
        }

        await this.trackUsersInChat(0, true);
        console.log(`Successfully updated ${numDeletedUsers} / ${userIds.length} as recently deleted.`);
        console.log(`Successfully updated ${numOutdatedUsernames} / ${userIds.length} outdated usernames.`);
        console.log(`Successfully flagged ${numUnbannedUsers} as unbanned.`);
        console.log(`Successfully synced ${numSyncedBans} active bans.`);
        console.log(`Successfully banned ${numBannedBots} known bots.`);
    }

    protected async updateChannelTitle(title: string): Promise<void> {
        await this.updateChannelInfo({ title: title });
        return;
    }

    protected async updateChannelGame(gameName?: string): Promise<void> {
        if (!gameName) {
            await this.updateChannelInfo({ game_id: "" });
            return;
        }

        const gameInfo = await this.getGame(gameName);
        await this.updateChannelInfo({ game_id: gameInfo.id });
        return;
    }

    protected async updateChannelInfo(settings: TwitchUpdateChannelInformationRequestBody): Promise<void> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const response = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`, {
            method: `PATCH`,
            headers: {
                Authorization: `Bearer ${(await this._userAccessToken).access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
                "Content-Type": `application/json`,
            },
            body: JSON.stringify(settings),
        });

        if (response.status !== 204) {
            const errMessage = `Update Channel Information request failed: ${response.status} ${response.statusText}`;
            console.log(errMessage);
            console.log(await response.json());
            throw new Error(errMessage);
        } else {
            console.log(`Update Channel Information request successful.`);
        }
    }

    protected async getGame(gameName: string): Promise<TwitchGame> {
        const appToken = await this._twitchAppToken;
        const response = await fetch(`https://api.twitch.tv/helix/games?name=${gameName}`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${appToken.access_token}`,
                "Client-Id": `${this._config.connection.twitch.oauth.clientId}`,
            }
        });

        if (response.status !== 200) {
            const errMessage = `Get Games request failed: ${response.status} ${response.statusText}`;
            console.log(errMessage);
            console.log(await response.json());
            throw new Error(errMessage);
        } else {
            console.log(`Get Games request successful.`);
        }

        const json: TwitchGetGamesResponseBody = await response.json();
        return json.data[0];
    }
}