import * as https from "https";
import { IIrcBotAuxCommandGroupConfig, IIrcBotConfig, IIrcBotConnectionConfig, IPartMessageDetail, IrcBotBase, IUserDetail } from "./IrcBot";

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

export abstract class TwitchBotBase<TUserDetail extends ITwitchUserDetail = ITwitchUserDetail> extends IrcBotBase<TUserDetail> {
    protected static _knownConfig = { encoding: "utf8" };

    public readonly _config: ITwitchBotConfig;
    protected _twitchIdByUsername: { [key: string]: string } = {}
    protected _usernameByTwitchId: { [key: string]: string } = {}
    protected _twitchApiToken: {
        access_token: string;
        expires_in: number;
    } | undefined = undefined;

    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], userDetailFilePath: string) {
        super(Object.assign(
            TwitchBotBase._knownConfig,
            { connection, auxCommandGroups, userDetailFilePath }
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
        const twitchChannelName = this._config.connection.server.channel.slice(1, this._config.connection.server.channel.length); // strip the leading # from the IRC channel name
        const isChannelLive = await this.isChannelLive(twitchChannelName);
        if (!isChannelLive) {
            // return;
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

    protected isChannelLive(channelName: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
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
                        if (channelInfoResponse.data.length === 0) {
                            resolve(false);
                            return;
                        }

                        const channelStatus = channelInfoResponse.data[0].type;
                        if (channelStatus === "live") {
                            resolve(true);
                            return;
                        }
                        resolve(false);
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