import * as http from "http";
import * as https from "https";
import { getPassword, setPassword } from "keytar";
import { Future } from "./Future";
import { CreateCustomChannelPointRewardArgs, ITwitchAuthConfig, TwitchAppToken, TwitchBannedUser, TwitchBroadcasterSubscriptionsResponse, TwitchChatSettings, TwitchErrorResponse, TwitchEventSub_CreateSubscription, TwitchEventSub_SubscriptionType, TwitchFollowingUser, TwitchGame, TwitchGetBannedUsersResponseBody, TwitchGetChannelInfo, TwitchGetChannelInfoResponse, TwitchGetCustomChannelPointRewardInfo, TwitchGetCustomChannelPointRewardResponse, TwitchGetFollowingUsersResponseBody, TwitchGetGamesResponseBody, TwitchGetShieldModeStatusResponseBody, TwitchGetStreamInfo, TwitchGetStreamsResponse, TwitchRequestArgs, TwitchSubscriptionDetail, TwitchUpdateChannelInformationRequestBody, TwitchUpdateChatSettingsRequestBody, TwitchUserAPIInfo, TwitchUserDetail, TwitchUserInfoResponse, TwitchUserToken } from "./TwitchApiTypes";
import { ConsoleColors } from "./ConsoleColors";

export interface TwitchApiConfig {
    twitchBroadcasterChannel: string;
    authConfig: ITwitchAuthConfig;
    serviceName: string;
}

export class TwitchApi {
    public readonly twitchBroadcasterChannel: string
    public readonly serviceName: string;

    protected readonly _authConfig: ITwitchAuthConfig;
    
    // Keep alphabetical for easier comparison against returned scope in refresh token
    protected readonly _userTokenScope = `bits:read channel:manage:broadcast channel:manage:redemptions channel:read:subscriptions moderator:manage:banned_users moderator:manage:chat_settings moderator:manage:shield_mode moderator:read:followers user:read:follows`;
    protected readonly _userAccessTokenAccountName = "default"; // TODO: find a good replacement for this
    protected readonly _twitchAppToken = new Future<TwitchAppToken>();
    protected _currentUserTokenRefreshPromise: Promise<TwitchUserToken> | undefined = undefined;

    public constructor(config: TwitchApiConfig) {
        this.twitchBroadcasterChannel = config.twitchBroadcasterChannel;
        this._authConfig = config.authConfig;
        this.serviceName = config.serviceName;
    }

    protected isValidTwitchUserLogin(username: string): boolean {
        const regex = /^[a-zA-Z0-9_]{4,25}$/;
        return regex.test(username);
    }

    public async startup(): Promise<void> {
        await this.loadAppAuthToken();
        await this.loadUserToken();
    }

    protected async loadAppAuthToken(): Promise<void> {
        console.log("Loading app auth token...");
        const promise = new Promise<void>((resolve, reject) => {
            const url = `https://id.twitch.tv/oauth2/token?client_id=${this._authConfig.clientId}&client_secret=${this._authConfig.clientSecret}&grant_type=client_credentials&scope=${this._authConfig.scope}`;
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

    protected async loadUserTokenSilent(): Promise<void> {
        const storedToken = await this.getStoredUserTokenResponse();
        if (!storedToken) {
            const message = `Unable to obtain user token silently: stored token string not found`;
            console.log(message);
            throw new Error(message);
        }
        console.log(`Stored user access token found.`);

        try {
            const refreshTokenResponse = await this.refreshUserToken(storedToken.refresh_token);
            if (refreshTokenResponse.scope.join(" ") !== this._userTokenScope) {
                throw new Error(`Refresh token scope does not match requested scope (${this._userTokenScope} !== ${refreshTokenResponse.scope.join(" ")})`);
            }
            await this.storeUserTokenResponse(refreshTokenResponse);
        } catch (err) {
            console.log(`Token Refresh failed: ${err}`);
            throw new Error(`Unable to obtain user token via refresh: ${err}`);
        }
    }

    protected async loadUserToken(): Promise<void> {
        const clientId = this._authConfig.clientId;

        try {
            await this.loadUserTokenSilent();
            return;
        } catch (err) {
            console.log(`Unable to load user token silently. ${err}`);
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
                client_id: this._authConfig.clientId,
                client_secret: this._authConfig.clientSecret,
                code: authCode,
                grant_type: "authorization_code",
                redirect_uri: redirectUrl,
            }
            const tokenRequestBody = Object.keys(tokenRequestBodyProps)
                .map(n => encodeURIComponent(n) + '=' + encodeURIComponent(tokenRequestBodyProps[n]!)).join('&');
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
            await this.storeUserTokenResponse(tokenResponseJson);
        };
        const server = http.createServer(handleRequest);
        server.listen(new URL(redirectUrl).port);

        const redirect_uri = redirectUrl;
        const url = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirect_uri}&response_type=code&scope=${this._userTokenScope}&force_verify=true`;
        await open(url);
    }

    public async getTwitchBroadcasterId(): Promise<string> {
        return this.getUserIdForUsername(this.twitchBroadcasterChannel);
    }

    public async getUserIdForUsername(username: string): Promise<string> {
        const map = await this.getUserIdsForUsernames([username]);
        return map[username]!;
    }

    public async getUserIdsForUsernames(usernames: string[]): Promise<{ [username: string]: string | undefined }> {
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

    public async getUserApiInfo(userIds: string[], userLogins: string[]): Promise<{ [userId: string]: TwitchUserAPIInfo | undefined }> {
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

            const getHeaders = async () => {
                const token = await this.getStoredUserTokenResponse();
                return {
                    Authorization: `Bearer ${token?.access_token ?? ""}`,
                    "Client-Id": `${this._authConfig.clientId}`,
                }
            }
            const requestArgs: TwitchRequestArgs = {
                method: `GET`,
                url: url,
                getHeaders: getHeaders,
            };
            const response = await this.sendTwitchRequest(requestArgs);

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

    protected async getGame(gameName: string): Promise<TwitchGame> {
        const appToken = await this._twitchAppToken;
        const response = await fetch(`https://api.twitch.tv/helix/games?name=${gameName}`, {
            method: `GET`,
            headers: {
                Authorization: `Bearer ${appToken.access_token}`,
                "Client-Id": `${this._authConfig.clientId}`,
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
        return json.data[0]!;
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

    public async updateChannelInfo(settings: TwitchUpdateChannelInformationRequestBody): Promise<void> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `PATCH`,
            url: `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
            getHeaders: getHeaders,
            body: JSON.stringify(settings),
        };
        const response = await this.sendTwitchRequest(requestArgs);

        if (response.status !== 204) {
            const errMessage = `Update Channel Information request failed: ${response.status} ${response.statusText}`;
            console.log(errMessage);
            console.log(await response.json());
            throw new Error(errMessage);
        } else {
            console.log(`Update Channel Information request successful.`);
        }
    }

    public async isChannelLive(channelName: string): Promise<boolean> {
        try {
            const channelInfoResponse = await this.getStreamDetails(channelName);
            const channelIsLive = channelInfoResponse.type === "live";
            return channelIsLive;
        } catch (err) {
            return false;
        }
    }

    public async getChannelDetails(channelName: string): Promise<TwitchGetChannelInfo> {
        const channelId = await this.getUserIdForUsername(channelName);
        const appToken = await this._twitchAppToken;
        return new Promise<TwitchGetChannelInfo>((resolve, reject) => {
    
            const options = {
                headers: {
                    Authorization: `Bearer ${appToken.access_token}`,
                    "client-id": `${this._authConfig.clientId}`,
                },
            };
            const request = https.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${channelId}`, options, (response) => {
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
                        resolve(channelInfoResponse.data[0]!);
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

    public async getStreamDetails(channelName: string): Promise<TwitchGetStreamInfo> {
        const appToken = await this._twitchAppToken;
        return new Promise<TwitchGetStreamInfo>((resolve, reject) => {
    
            const options = {
                headers: {
                    Authorization: `Bearer ${appToken.access_token}`,
                    "client-id": `${this._authConfig.clientId}`,
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
                        resolve(channelInfoResponse.data[0]!);
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
     * @param userLogin If undefined, this function returns retrieves info for the id tied to the active user access token
     * @returns 
     */
    public async getUserApiInfoSingle(userId?: string): Promise<TwitchUserAPIInfo | undefined> {
        if (userId === undefined || userId === "") {
            return this._getUserApiInfoFromToken();
        }

        const userInfoDict = await this.getUserApiInfo([userId], []);
        const keys = Object.keys(userInfoDict);
        if (keys.length === 0) {
            throw new Error(`Error retrieving API info for username: ${userId}`);
        }
        const userInfo = userInfoDict[keys[0]!];
        return userInfo;
    }

    protected async sendTwitchRequest(args: TwitchRequestArgs): Promise<Response> {
        const makeRequest = async () => {
            const headers = await args.getHeaders();
            console.log(`Making request to Twitch with the following headers:`);
            console.log(headers);
            const response = await fetch(args.url, {
                method: args.method,
                headers: headers,
                body: args.body,
            });
            return response;
        }

        const maxRetries = 1;
        let retryCount = 0;
        let response = await makeRequest();
        const autoRetryResponses = [401];
        while (autoRetryResponses.includes(response.status) && retryCount < maxRetries) {
            console.log(`Auto-retry attempt #${maxRetries}. Received status ${response.status}`);
            retryCount++;
            if (response.status === 401) { // Unauthorized
                await this.loadUserTokenSilent();
                response = await makeRequest();
                continue;
            }
        }

        if (autoRetryResponses.includes(response.status)) {
            const message = `Unable to auto-correct Twitch response after ${retryCount} retries. Received code ${response.status}.`;
            console.log(message)
            console.log(response);
            throw new Error(message);
        }
        
        if (retryCount > 0) {
            console.log(`Retry successful after ${retryCount} attempts! Received response ${response.status}`);
        }
        return response;
    }

    protected async _getUserApiInfoFromToken(): Promise<TwitchUserAPIInfo> {
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `GET`,
            url: `https://api.twitch.tv/helix/users`,
            getHeaders: getHeaders,
        };
        const response = await this.sendTwitchRequest(requestArgs);

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

        return userApiInfoArray[0]!;
    }

    protected async _refreshUserToken(refreshToken: string): Promise<TwitchUserToken> {
        console.log(`Attempting to obtain user access token via refresh token...`);

        const tokenRequestBodyProps: { [key: string]: string } = {
            client_id: this._authConfig.clientId,
            client_secret: this._authConfig.clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        };
        const tokenRequestBody = Object.keys(tokenRequestBodyProps)
            .map(n => encodeURIComponent(n) + '=' + encodeURIComponent(tokenRequestBodyProps[n]!)).join('&');
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

    protected async refreshUserToken(refreshToken: string): Promise<TwitchUserToken> {
        if (!!this._currentUserTokenRefreshPromise) {
            return this._currentUserTokenRefreshPromise;
        }

        const future = new Future<TwitchUserToken>();
        this._currentUserTokenRefreshPromise = future.asPromise();

        try {
            const token = await this._refreshUserToken(refreshToken);
            future.resolve(token);
        } catch (err) {
            future.reject(err);
        }

        this._currentUserTokenRefreshPromise = undefined;
        return future;
    }

    protected async storeUserTokenResponse(tokenResponse: TwitchUserToken): Promise<void> {
        await setPassword(this.serviceName, this._userAccessTokenAccountName, JSON.stringify(tokenResponse));
        console.log(`Successfully stored user token response`);
    }

    protected async getStoredUserTokenResponse(): Promise<TwitchUserToken | undefined> {
        const storedTokenString = await getPassword(this.serviceName, this._userAccessTokenAccountName);
        if (storedTokenString === null) {
            return undefined;
        }
        // console.log(`Successfully retrieved stored user token response`); // TODO: log this at trace level
        const token = JSON.parse(storedTokenString);
        // console.log(`Successfully parsed stored user token response`); // TODO: log this at trace level
        return token;
    }

    public async ban(channelUsername: string, usernameToBan: string): Promise<void> {
        console.log(`Banning ${usernameToBan} in channel #${channelUsername}`);
        const broadcasterId = await this.getUserIdForUsername(channelUsername);
        const userIdToBan = await this.getUserIdForUsername(usernameToBan);
        const body = {
            data: {
                user_id: userIdToBan,
            }
        }

        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`, // TODO: sign in with the chatbot account for this
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `POST`,
            url: `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
            getHeaders: getHeaders,
            body: JSON.stringify(body),
        };
        const response = await this.sendTwitchRequest(requestArgs);

        if (response.status !== 200) {
            const badResponseJson: any = await response.json();
            console.log(`Ban request failed: ${response.status} ${response.statusText}`);
            console.log(badResponseJson);
        } else {
            console.log(`Ban against ${usernameToBan} (id: ${userIdToBan}) Successful.`);
        }
    }

    public async timeout2(targetUser: TwitchUserDetail, durationSeconds?: number): Promise<void> {
        console.log(`Timing out ${targetUser.username} in channel ${this.twitchBroadcasterChannel}`);
        const broadcasterId = await this.getTwitchBroadcasterId();
        const body = {
            data: {
                user_id: targetUser.id,
                duration: durationSeconds,
            }
        }

        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`, // TODO: sign in with the chatbot account for this
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `POST`,
            url: `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
            getHeaders: getHeaders,
            body: JSON.stringify(body),
        };
        const response = await this.sendTwitchRequest(requestArgs);
        if (response.status !== 200) {
            const badResponseJson: any = await response.json();
            console.log(`Timeout request failed: ${response.status} ${response.statusText}`);
            console.log(badResponseJson);
        } else {
            console.log(`Timeout Successful.`);
        }
    }

    public async getChannelPointRewards(): Promise<TwitchGetCustomChannelPointRewardInfo[]> {
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `GET`,
            url: `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${this.twitchBroadcasterChannel}`,
            getHeaders: getHeaders,
        };
        const response = await this.sendTwitchRequest(requestArgs);
        if (response.status === 200) {
            const json: TwitchGetCustomChannelPointRewardResponse = await response.json();
            return json.data;
        }

        throw new Error(`Unable to retrieve channel point rewards: ${response.status} error (${(await response.json()).message})`);
    }

    public async createChannelPointReward(body: CreateCustomChannelPointRewardArgs): Promise<void> {
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `POST`,
            url: `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${this.twitchBroadcasterChannel}`,
            getHeaders: getHeaders,
            body: JSON.stringify(body),
        };
        const response = await this.sendTwitchRequest(requestArgs);
        if (response.status === 200) {
            return;
        }

        throw new Error(`Unable to create new channel point reward: ${response.status} error (${(await response.json()).message})`);
    }

    public async updateChannelPointRedemption(redemption_id: string, reward_id: string, broadcaster_id: string, fulfill?: boolean): Promise<void> {
        const body = {
            status: fulfill ? "FULFILLED" : "CANCELED",
        };
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `PATCH`,
            url: `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${broadcaster_id}&reward_id=${reward_id}&id=${redemption_id}`,
            getHeaders: getHeaders,
            body: JSON.stringify(body),
        };
        const response = await this.sendTwitchRequest(requestArgs);
        if (response.status === 200) {
            return;
        }

        throw new Error(`Unable to update redemption status: ${response.status} error (${(await response.json()).message})`);
    }

    public async getBannedUsers(): Promise<TwitchBannedUser[]> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const bannedUsers: TwitchBannedUser[] = [];

        let cursor: string | undefined = undefined
        const pageSize = 100;

        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }

        while (true) {
            const requestArgs: TwitchRequestArgs = {
                method: `GET`,
                url: `https://api.twitch.tv/helix/moderation/banned?broadcaster_id=${broadcasterId}&first=${pageSize}${!!cursor ? `&after=${cursor}` : ``}`,
                getHeaders: getHeaders,
            };
            const response = await this.sendTwitchRequest(requestArgs);

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

    public async getFollowers(): Promise<TwitchFollowingUser[]> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const followingUsers: TwitchFollowingUser[] = [];
        let cursor: string | undefined = undefined

        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }

        while (true) {
            const requestArgs: TwitchRequestArgs = {
                method: `GET`,
                url: `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=${100}${!!cursor ? `&after=${cursor}` : ``}`,
                getHeaders: getHeaders,
            };
            const response = await this.sendTwitchRequest(requestArgs);
    
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

    public async createEventSubSubscription(topic: TwitchEventSub_SubscriptionType, sessionId: string): Promise<void> {
        const body: TwitchEventSub_CreateSubscription = {
            type: topic.name,
            version: topic.version,
            condition: topic.condition,
            transport: {
                method: "websocket",
                session_id: sessionId,
            }
        };
        // Websockets are read-only (aside from PONG responses), so subscriptions are set up via HTTP instead (just like webhooks)
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `POST`,
            url: `https://api.twitch.tv/helix/eventsub/subscriptions`,
            getHeaders: getHeaders,
            body: JSON.stringify(body),
        };
        const subscriptionResponse = await this.sendTwitchRequest(requestArgs);

        if (subscriptionResponse.status === 202) {
            return;
        } else {
            const message = `Error subscribing to specific EventSub (${subscriptionResponse.status} response):`;
            console.log(message);
            throw new Error(message);
        }
    }

    public async isShieldModeEnabled(): Promise<boolean> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `GET`,
            url: `https://api.twitch.tv/helix/moderation/shield_mode?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
            getHeaders: getHeaders,
        };
        const response = await this.sendTwitchRequest(requestArgs);

        if (response.status !== 200) {
            console.log(`Get Shield Mode request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Get Shield Mode request successful.`);
        }

        const json: TwitchGetShieldModeStatusResponseBody = await response.json();
        return json.data[0]!.is_active;
    }

    public async updateShieldMode(enable: boolean): Promise<void> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const body = {
            is_active: enable,
        };
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `PUT`,
            url: `https://api.twitch.tv/helix/moderation/shield_mode?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
            getHeaders: getHeaders,
            body: JSON.stringify(body),
        };
        const response = await this.sendTwitchRequest(requestArgs);

        if (response.status !== 200) {
            console.log(`Update Shield Mode request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Update Shield Mode request successful.`);
        }
        return;
    }

    public async getChatSettings(): Promise<TwitchChatSettings> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `GET`,
            url: `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
            getHeaders: getHeaders,
        };
        const response = await this.sendTwitchRequest(requestArgs);

        if (response.status !== 200) {
            console.log(`Get Chat Settings request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Get Chat Settings request successful.`);
        }

        const getChatSettingsJson = await response.json();
        return getChatSettingsJson.data[0];
    }

    public async updateChatSettings(settings: TwitchUpdateChatSettingsRequestBody): Promise<void> {
        const broadcasterId = await this.getTwitchBroadcasterId();
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `PATCH`,
            url: `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
            getHeaders: getHeaders,
            body: JSON.stringify(settings),
        };
        const response = await this.sendTwitchRequest(requestArgs);

        if (response.status !== 200) {
            console.log(`Update Chat Settings request failed: ${response.status} ${response.statusText}`);
            console.log(await response.json());
        } else {
            console.log(`Update Chat Settings request successful.`);
        }

        return;
    }

    public async getEventSubSubscriptions(): Promise<any[]> {
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        const requestArgs: TwitchRequestArgs = {
            method: `GET`,
            url: `https://api.twitch.tv/helix/eventsub/subscriptions`,
            getHeaders: getHeaders,
        };
        const response = await this.sendTwitchRequest(requestArgs);
        const json = await response.json();
        return json.data;
    }

    public async deleteUnusedEventSubSubscriptions(subs: any[]): Promise<void> {
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }

        let numDeleted = 0;
        for (const sub of subs) { // TODO: fix subs not iterable error
            if (sub.status === "websocket_failed_ping_pong" || "websocket_disconnected") {
                const requestArgs: TwitchRequestArgs = {
                    method: `DELETE`,
                    url: `https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`,
                    getHeaders: getHeaders,
                };
                const deleteResponse = await this.sendTwitchRequest(requestArgs);
                if (deleteResponse.status === 204) {
                    numDeleted++;
                }
            }
        }
        console.log(`  ${ConsoleColors.FgYellow}Deleted ${numDeleted} useless subscriptions${ConsoleColors.Reset}\n`);
    }

    public async getActiveBroadcasterSubcriptions(): Promise<{ subPoints: number, subCount: number, subDetails: TwitchSubscriptionDetail[] }> {
        // TODO: fetch more than 100 subs via paging
        const broadcasterId = await this.getTwitchBroadcasterId();
        const subscribedUsers: TwitchSubscriptionDetail[] = [];

        let cursor: string | undefined = undefined;
        const pageSize = 100;
        let subPoints = 0;
        let subCount = 0;
        
        const getHeaders = async () => {
            const token = await this.getStoredUserTokenResponse();
            return {
                Authorization: `Bearer ${token?.access_token ?? ""}`,
                "Client-Id": `${this._authConfig.clientId}`,
                "Content-Type": `application/json`,
            }
        }
        
        while (true) {
            const requestArgs: TwitchRequestArgs = {
                method: `GET`,
                url: `https://api.twitch.tv/helix/subscriptions?broadcaster_id=${broadcasterId}&first=${pageSize}${!!cursor ? `&after=${cursor}` : ``}`,
                getHeaders: getHeaders,
            };
            const response = await this.sendTwitchRequest(requestArgs);
    
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
}