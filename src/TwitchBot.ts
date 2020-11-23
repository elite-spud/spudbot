import * as https from "https";
import { IIrcBotAuxCommandGroupConfig, IIrcBotConfig, IIrcBotConnectionConfig, IrcBot, IUserDetail, IUserDetails } from "./IrcBot";

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

export class TwitchBot<TUserDetail extends ITwitchUserDetail = ITwitchUserDetail> extends IrcBot<TUserDetail> {
    protected static _knownConfig = { encoding: "utf8" };

    public readonly _config: ITwitchBotConfig<TUserDetail>;
    protected _twitchIdByUsername: { [key: string]: string } = {}

    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], userDetails: IUserDetails<TUserDetail>) {
        super(Object.assign(TwitchBot._knownConfig, { connection, auxCommandGroups, userDetails } ));
        
        console.log("Performing Request...")
        const authRequest = https.request(`https://id.twitch.tv/oauth2/token?client_id=${connection.twitch.oauth.clientId}&client_secret=${connection.twitch.oauth.clientSecret}&grant_type=client_credentials&scope=${connection.twitch.oauth.scope}`, {
                method: "POST",
                port: 443,
            },
            (response) => {
                response.on('data', (data: Buffer) => {
                    console.log("GOT DATA");
                    const dataStr = data.toString("utf8");
                    console.log(dataStr);
                });
            });
        authRequest.on("error", (err) => {
            console.log("AUTH ERROR");
            console.log(err);
        });
        authRequest.end();
        // TODO: Setup token refresh maybe
    }

    // protected addUserToChat(username: string): void {
    //     let twitchId = this._twitchIdByUsername[username];
    //     if (!twitchId) {
    //         twitchId = https.get("https://api.twitch.tv/helix/users", {
    //             auth: this.config.connection.server.
    //         })
    //     }


    //     this._usersInChat[twitchId] = true;
    // }

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