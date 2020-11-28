import * as https from "https";
import { IIrcBotAuxCommandGroupConfig, IIrcBotConfig, IIrcBotConnectionConfig, IPartMessageDetail, IPrivMessageDetail, IrcBotBase, IUserDetail } from "./IrcBot";

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

export interface TwitchChannelInfoResponse {
    data: {
        id: string, // Stream Id
        user_id: string,
        user_name: string,
        game_id: string,
        game_name: string,
        type: "live" | string,
        title: string,
        viewer_count: number,
        /** ISO format date string */
        started_at: string,
        language: string,
        thumbnail_url: string,
        tag_ids: string[]
    }[],
    pagination: {
    }
}

export interface TwitchErrorResponse {
    error: string,
    status: number, // HTTP status code
    message: string,
}

export type TwitchPrivMessageTagKeys = "badge-info" | "badges" | "client-nonce" | "color" | "display-name" | "emotes" | "flags" | "id" | "mod" | "room-id" | "subscriber" | "tmi-sent-ts" | "turbo" | "user-id" | "user-type" | string;
export type TwitchBadgeTagKeys = "admin" | "bits" | "broadcaster" | "global_mod" | "moderator" | "subscriber" | "staff" | "turbo" | string;

export abstract class TwitchBotBase<TUserDetail extends ITwitchUserDetail = ITwitchUserDetail> extends IrcBotBase<TUserDetail> {
    protected static _knownConfig = { encoding: "utf8" };

    public readonly _config: ITwitchBotConfig;
    protected _twitchIdByUsername: { [key: string]: string } = {}
    protected _usernameByTwitchId: { [key: string]: string } = {}
    protected _twitchApiToken: {
        access_token: string;
        expires_in: number;
    } | undefined = undefined;

    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], userDetailFilePath: string, chatHistoryFilePath: string) {
        super(Object.assign(
            TwitchBotBase._knownConfig,
            { connection, auxCommandGroups, userDetailFilePath, chatHistoryFilePath }
        ));
        
        console.log("Performing Request...")
        const authRequest = https.request(`https://id.twitch.tv/oauth2/token?client_id=${connection.twitch.oauth.clientId}&client_secret=${connection.twitch.oauth.clientSecret}&grant_type=client_credentials&scope=${connection.twitch.oauth.scope}`, {
                method: "POST",
                port: 443,
            },
            (response) => {
                response.on("data", (data: Buffer) => {
                    const responseJson = JSON.parse(data.toString("utf8"));
                    if (responseJson.access_token) {
                        this._twitchApiToken = responseJson;
                        console.log("Successfully obtained API token from twitch.")
                    } else {
                        console.log("Issue retrieving access token from twitch:");
                        console.log(responseJson);
                    }
                });
            });
        authRequest.on("error", (err) => {
            console.log("Error sending auth token request to twitch:");
            console.log(err);
        });
        authRequest.end();
        // TODO: Setup token refresh
    }

    /** @override */
    protected async getUserIdForUsername(username: string): Promise<string> {
        try {
            const userId = await this.getTwitchIdWithCache(username);
            return userId;
        } catch (err) {
            throw new Error("Error receiving user id from twitch");
        }
    }

    /** @override */
    protected async trackUsersInChat(secondsToAdd: number): Promise<void> {
        const isChannelLive = await this.isChannelLive(this.twitchChannelName);
        if (!isChannelLive) {
            return;
        }

        super.trackUsersInChat(secondsToAdd);
    }

    /** @override */
    protected async handlePart(messageDetail: IPartMessageDetail): Promise<void> {
        super.handlePart(messageDetail);
        
        // Ensure we refresh the username-twitchId map every time someone joins 
        const twitchId = this._twitchIdByUsername[messageDetail.username];
        delete this._usernameByTwitchId[twitchId];
        delete this._twitchIdByUsername[messageDetail.username];
    }

    protected get twitchChannelName(): string {
        const twitchChannelName = this._config.connection.server.channel.slice(1, this._config.connection.server.channel.length); // strip the leading # from the IRC channel name
        return twitchChannelName;
    }

    protected async isChannelLive(channelName: string): Promise<boolean> {
        try {
            const channelInfoResponse = await this.getStreamDetails(channelName);
            if (channelInfoResponse.data.length === 0) {
                return false;
            }
            const channelStatus = channelInfoResponse.data[0].type;
            if (channelStatus === "live") {
                return true;
            }
            return false;
        } catch (err) {
            return false;
        }
    }

    protected async getStreamDetails(channelName: string): Promise<TwitchChannelInfoResponse> {
        return new Promise<TwitchChannelInfoResponse>((resolve, reject) => {
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
                        const responseJson: TwitchChannelInfoResponse | TwitchErrorResponse = JSON.parse(data.toString("utf8"));
                        const errorResponse = responseJson as TwitchErrorResponse;
                        if (errorResponse.error) {
                            reject(`Error retrieving channel info from twitch API: ${errorResponse.status} ${errorResponse.error}: ${errorResponse.message}`);
                            return;
                        }

                        const channelInfoResponse = responseJson as TwitchChannelInfoResponse;
                        resolve(channelInfoResponse);
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
                this._usernameByTwitchId[id] = username;
            } catch (err) {
                throw new Error(`Error retrieving twitch user id: ${err}`);
            }
        }
        
        return id;
    }

    protected async getTwitchId(username: string): Promise<string> {
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

    public startup(): void {
        super.startup();
        this.sendRaw("CAP REQ :twitch.tv/membership"); // Request capability to receive JOIN and PART events from users connecting to channels)
        this.sendRaw("CAP REQ :twitch.tv/commands"); // Request capability to receive twitch-specific commands (Timeouts, chat clears, host notifications, subscriptions, etc.)
        this.sendRaw("CAP REQ :twitch.tv/tags"); // Request capability to augment certain IRC messages with tag metadata
    }

    public timeout(channel: string, username: string, durationSeconds: number): void {
        this.chat(channel, `/timeout ${username} ${durationSeconds}`);
    }

    public clearTimeout(channel: string, username: string): void {
        this.timeout(channel, username, 1);
    }
}

export class TwitchBot extends TwitchBotBase<ITwitchUserDetail> {
    protected async createUserDetail(userId: string): Promise<ITwitchUserDetail> {
        const username = this._usernameByTwitchId[userId];
        if (!username) {
            throw new Error(`Cannot create a user detail for userId: ${userId} with unknown username`);
        }

        const twitchUserDetail: ITwitchUserDetail = {
            id: userId,
            username: username,
            secondsInChat: 0,
            numChatMessages: 0,
        };
        return twitchUserDetail;
    }
}