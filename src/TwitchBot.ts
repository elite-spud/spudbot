import * as https from "https";
import { IIrcBotAuxCommandGroupConfig, IIrcBotConfig, IIrcBotConnectionConfig, IrcBot, IUserDetail, IUserDetails, UserChatStatus } from "./IrcBot";

export interface ITwitchUserDetail extends IUserDetail {
    /** globally unique id for a twitch user (persists between username changes) */
    id: string;
}

export interface ITwitchBotConfig<TUserDetail extends IUserDetail> extends IIrcBotConfig<TUserDetail> {
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

export class TwitchBot<TUserDetail extends ITwitchUserDetail = ITwitchUserDetail> extends IrcBot<TUserDetail> {
    protected static _knownConfig = { encoding: "utf8" };

    public readonly _config: ITwitchBotConfig<TUserDetail>;
    protected _twitchIdByUsername: { [key: string]: string } = {}
    protected _twitchApiToken: {
        access_token: string;
        expires_in: number;
    } | undefined = undefined;

    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], userDetails: IUserDetails<TUserDetail>) {
        super(Object.assign(TwitchBot._knownConfig, { connection, auxCommandGroups, userDetails } ));
        
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

    protected async addUserToChat(username: string): Promise<void> {
        this._usersInChat[username] = UserChatStatus.Connected;
        let id: string;
        try {
            id = await this.getTwitchIdWithCache(username);
        } catch (err) {
            console.log(`Unable to add twitch user id for user: ${username} to chat: ${err}`);
            return;
        }

        if (this._usersInChat[username] !== undefined) {
            delete this._usersInChat[username];
        }
        this._usersInChat[id] = UserChatStatus.Connected;
        console.log(`Successfully added user '${username}' with id '${id}' to chat.`);
    }

    protected async removeUserFromChat(username: string): Promise<void> {
        if (this._usersInChat[username] !== undefined) {
            delete this._usersInChat[username];
        }
        let id: string;
        try {
            id = await this.getTwitchIdWithCache(username);
        } catch (err) {
            console.log(`Unable to remove twitch user id for user: ${username} from chat: ${err}`);
            return;
        }

        if (this._usersInChat[username]) {
            this._usersInChat[username] = UserChatStatus.Disconnected;
        }
        this._usersInChat[id] = UserChatStatus.Disconnected;
        console.log(`Successfully removed user '${username}' with id '${id}' from chat.`);
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
                    const responseJson: TwitchUserInfoResponse = JSON.parse(data.toString("utf8"));
                    const id = responseJson?.data[0]?.id;
                    if (id) {
                        resolve(id);
                    } else {
                        reject(`Error retrieving user info from twitch API: ${responseJson}`);
                    }
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
        this.sendRaw("CAP REQ :twitch.tv/membership"); // Request capability to read twitch-specific commands (Timeouts, chat clears, host notifications, subscriptions, etc.)
        this.sendRaw("CAP REQ :twitch.tv/commands"); // Request capability to read twitch-specific commands (Timeouts, chat clears, host notifications, subscriptions, etc.)
        this.sendRaw("CAP REQ :twitch.tv/tags"); // Request capability to augment certain IRC messages with tag metadata
    }

    public timeout(channel: string, username: string, durationSeconds: number): void {
        this.chat(channel, `/timeout ${username} ${durationSeconds}`);
    }

    public clearTimeout(channel: string, username: string): void {
        this.timeout(channel, username, 1);
    }
}