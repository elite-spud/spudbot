import * as https from "https";
import { IIrcBotAuxCommandConfig, IIrcBotAuxCommandGroupConfig, IIrcBotConfig, IIrcBotConnectionConfig, IJoinMessageDetail, IPartMessageDetail, IPrivMessageDetail, IrcBotBase, IUserDetail } from "./IrcBot";

export interface ITwitchUserDetail extends IUserDetail {
    /** globally unique id for a twitch user (persists between username changes) */
    id: string;
}

export interface ITwitchBotConfig extends IIrcBotConfig {
    connection: ITwitchBotConnectionConfig;
}

export interface ITwitchBotConnectionConfig extends IIrcBotConnectionConfig {
    twitch: {
        oauth: {
            clientId: string;
            clientSecret: string;
            scope: string;
        }
    }
}

export interface TwitchUserInfoResponse {
    data: {
            id: string;
            login: string;
            display_name: string;
            created_at: string;
    }[],
}

export interface TwitchGetChannelInfo {
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    broadcaster_language: string;
    game_name: string;
    game_id: string;
    title: string;
    delay: number;
    tags: string[];
}

export interface TwitchGetChannelInfoResponse {
    data: TwitchGetChannelInfo[];
}

export interface TwitchSearchChannelInfo {
    broadcaster_language: string;
    broadcaster_login: string;
    display_name: string;
    game_id: string;
    game_name: string;
    id: string;
    is_live: boolean;
    tags: string[];
    thumbnail_url: string;
    title: string;
    started_at: string;
}

export interface TwitchSearchChannelsResponse {
    data: TwitchSearchChannelInfo[],
    pagination: {
    },
}

export interface TwitchGetStreamInfo {
    id: string; // Stream Id
    user_id: string;
    user_name: string;
    game_id: string;
    game_name: string;
    type: "live" | string;
    title: string;
    viewer_count: number;
    /** ISO format date string */
    started_at: string;
    language: string;
    thumbnail_url: string;
    tag_ids: string[];
}

export interface TwitchGetStreamsResponse {
    data: TwitchGetStreamInfo[],
    pagination: {
    },
}

export interface TwitchErrorResponse {
    error: string,
    status: number, // HTTP status code
    message: string,
}

export interface ITwitchBotAuxCommandConfig extends IIrcBotAuxCommandConfig {
    /** Only post automatically (as part of a timer) when these categories are being streamed */
    autoPostGameWhitelist?: string[];
    /** Only post automatically (as part of a timer) if the title contains any of these strings */
    autoPostIfTitleContainsAny?: string[];
}

export type TwitchPrivMessageTagKeys = "badge-info" | "badges" | "client-nonce" | "color" | "display-name" | "emotes" | "flags" | "id" | "mod" | "room-id" | "subscriber" | "tmi-sent-ts" | "turbo" | "user-id" | "user-type" | string;
export type TwitchBadgeTagKeys = "admin" | "bits" | "broadcaster" | "global_mod" | "moderator" | "subscriber" | "staff" | "turbo" | string;

export abstract class TwitchBotBase<TUserDetail extends ITwitchUserDetail = ITwitchUserDetail> extends IrcBotBase<TUserDetail> {
    public static readonly maxChatMessageLength = 500
    protected static readonly _knownConfig = { encoding: "utf8" };

    public override readonly _config: ITwitchBotConfig;
    protected _twitchIdByUsername: { [key: string]: string } = {}
    protected _twitchApiToken: {
        access_token: string;
        expires_in: number;
    } | undefined = undefined;

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
            throw new Error("Error receiving user id from twitch");
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

        await this.hasStarted;
        return new Promise<TwitchGetChannelInfo>((resolve, reject) => {
            if (!this._twitchApiToken) {
                reject("Cannot retrieve user id from twitch without authorization!");
                return;
            }
    
            const options = {
                headers: {
                    Authorization: `Bearer ${this._twitchApiToken.access_token}`,
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
        await this.hasStarted;
        return new Promise<TwitchGetStreamInfo>((resolve, reject) => {
            if (!this._twitchApiToken) {
                reject("Cannot retrieve user id from twitch without authorization!");
                return;
            }
    
            const options = {
                headers: {
                    Authorization: `Bearer ${this._twitchApiToken.access_token}`,
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

    protected async getTwitchIdWithCache(username: string): Promise<string> {
        let id: string | undefined = this._twitchIdByUsername[username];
        if (!id) {
            try {
                id = await this.getTwitchId(username);
                this._twitchIdByUsername[username] = id;
            } catch (err) {
                throw new Error(`Error retrieving twitch user id: ${err}`);
            }
        }
        
        return id;
    }

    protected async getTwitchId(username: string): Promise<string> {
        await this.hasStarted;
        return new Promise<string>((resolve, reject) => {
            if (!this._twitchApiToken) {
                reject("Cannot retrieve user id from twitch without authorization!");
                return;
            }

            const options = {
                headers: {
                    Authorization: `Bearer ${this._twitchApiToken.access_token}`,
                    "client-id": `${this._config.connection.twitch.oauth.clientId}`,
                },
            };
            const request = https.get(`https://api.twitch.tv/helix/users?login=${username}`, options, (response) => {
                response.on("data", (data) => {
                    const responseJson: TwitchUserInfoResponse | TwitchErrorResponse = JSON.parse(data.toString("utf8"));
                    const errorResponse = responseJson as TwitchErrorResponse;
                    if (errorResponse.error) {
                        reject(`Error retrieving user info from twitch API: ${errorResponse.status} ${errorResponse.error}: ${errorResponse.message}`);
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

    protected async loadAuthToken(): Promise<void> {
        console.log("Performing Request...");
        const promise = new Promise<void>((resolve, reject) => {
            const authRequest = https.request(`https://id.twitch.tv/oauth2/token?client_id=${this._config.connection.twitch.oauth.clientId}&client_secret=${this._config.connection.twitch.oauth.clientSecret}&grant_type=client_credentials&scope=${this._config.connection.twitch.oauth.scope}`, {
                    method: "POST",
                    port: 443,
                },
                (response) => {
                    response.on("data", (data: Buffer) => {
                        const responseJson = JSON.parse(data.toString("utf8"));
                        if (responseJson.access_token) {
                            this._twitchApiToken = responseJson;
                            console.log("Successfully obtained API token from twitch.");
                            resolve();
                        } else {
                            const message = `Issue retrieving access token from twitch: ${responseJson}`
                            console.log(message);
                            reject(message);
                        }
                    });
                });

            authRequest.on("error", (err) => {
                console.log("Error sending auth token request to twitch:");
                console.log(err);
                reject(err);
            });
            authRequest.end();
            // TODO: Setup token refresh
        });
        return promise;
    }

    public override async _startup(): Promise<void> {
        await super._startup();

        await this.loadAuthToken();

        // TODO: listen for channel points redemptions by subscribing to a websocket feed: https://dev.twitch.tv/docs/pubsub#example-channel-points-event-message
        
        this.sendRaw("CAP REQ :twitch.tv/membership"); // Request capability to receive JOIN and PART events from users connecting to channels)
        this.sendRaw("CAP REQ :twitch.tv/commands"); // Request capability to send & receive twitch-specific commands (timeouts, chat clears, host notifications, subscriptions, etc.)
        this.sendRaw("CAP REQ :twitch.tv/tags"); // Request capability to augment certain IRC messages with tag metadata
    }

    public timeout(channel: string, username: string, durationSeconds: number): void {
        this.chat(channel, `/timeout ${username} ${durationSeconds}`);
    }

    public clearTimeout(channel: string, username: string): void {
        this.timeout(channel, username, 1);
    }

    public override chat(recipient: string, message: string): void {
        let actualMessage = message;
        if (message.length > TwitchBotBase.maxChatMessageLength) {
            actualMessage = "<Message was too long. Please file a bug report with the owner :)>";
            console.log(`Message too long for Twitch: ${message}`);
        }
        super.chat(recipient, actualMessage);
    }
}
