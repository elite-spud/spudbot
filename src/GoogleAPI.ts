import { JWT } from "google-auth-library";
import { google, sheets_v4 } from "googleapis";
import { Future } from "./Future";
import { TaskQueue } from "./TaskQueue";
import { TwitchBotBase } from "./TwitchBot";
import { ITwitchUserDetail, TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Notification_Subscription } from "./TwitchBotTypes";
import { GameRequest_Spreadsheet } from "./spreadsheets/GameRequestSpreadsheet";
import { pushSpreadsheet } from "./spreadsheets/SpreadsheetBase";

export interface GoogleAPIConfig {
    oauth: {
        clientId: string;
        clientSecret: string;
        scope: string;
    };
    jwt: {
        type: string,
        project_id: string,
        private_key_id: string,
        private_key: string,
        client_email: string,
        client_id: string,
        auth_uri: string,
        token_uri: string,
        auth_provider_x509_cert_url: string,
        client_x509_cert_url: string,
        universe_domain: string,
    };
}

export class GoogleAPI {
    public static readonly incentiveSheetId = "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY";
    public static readonly bidwarTestSubSheet = "Sheet3";
    public static readonly gameRequestTestReadSubSheet = 1313890864;
    public static readonly gameRequestTestWriteSubSheet = 1834520193;

    protected readonly _config: GoogleAPIConfig
    protected readonly _twitchBot: TwitchBotBase<ITwitchUserDetail>;
    public readonly _googleSheets = new Future<sheets_v4.Sheets>();

    protected _taskQueue: TaskQueue = new TaskQueue();

    public constructor(config: GoogleAPIConfig, twitchBot: TwitchBotBase<ITwitchUserDetail>) { // TODO: make a singleton?
        this._config = config;
        this._twitchBot = twitchBot;
    }

    public async startup(): Promise<void> {
        const client = new JWT({
            email: this._config.jwt.client_email,
            key: this._config.jwt.private_key,
            scopes: ["https://www.googleapis.com/auth/drive"],
        });

        const sheets = google.sheets({
            version: 'v4',
            auth: await client,
        });

        this._googleSheets.resolve(sheets);
    }

    public async handleGameRequestRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd): Promise<void> {
        const pointsWereApplied = await this.handleGameRequestFund(`#${event.broadcaster_user_name}`, event.user_input, event.user_name, event.reward.cost, new Date(event.redeemed_at));
        if (pointsWereApplied) {
            await this._twitchBot.updateChannelPointRedemptions(event.id, event.reward.id, event.broadcaster_user_id, true);
        }
    }

    /**
     * @param respondTo 
     * @param gameName 
     * @param username 
     * @param points 
     * @param timestamp 
     * @returns whether or not the reward was successfully completed
     */
    public async handleGameRequestFund(respondTo: string, gameName: string, username: string, points: number, timestamp: Date): Promise<boolean> {
        const future = new Future<boolean>();
        const task = async (): Promise<void> => {
            const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestTestReadSubSheet);
            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (!existingEntry) {
                this._twitchBot.chat(respondTo, `@${username}, your game request detected as a new request; please allow an admin to add this game to the spreadsheet before adding any further points https://docs.google.com/spreadsheets/d/1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY/edit?gid=384782784#gid=384782784`);
                future.resolve(false);
                return;
            }

            gameRequestSpreadsheet.addPointsToEntry(username, gameName, points, timestamp);
            await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestTestWriteSubSheet, gameRequestSpreadsheet);
            this._twitchBot.chat(respondTo, `@${username}, your points were successfully added to game request.`);
            future.resolve(true);
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestAdd(respondTo: string, gameName: string, gameLengthHours: number, pointsToActivate: number | undefined, username: string, points: number, timestamp: Date): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestTestReadSubSheet);
            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (existingEntry) {
                this._twitchBot.chat(respondTo, `Game request already present in spreadsheet.`);
                future.resolve();
                return;
            }
            
            gameRequestSpreadsheet.addEntry(gameName, gameLengthHours, pointsToActivate, username, points, timestamp);
            await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestTestWriteSubSheet, gameRequestSpreadsheet);
            this._twitchBot.chat(respondTo, `Game request successfully added.`);
            future.resolve();
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleCheer(_event: TwitchEventSub_Event_Cheer, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        // const future = new Future<void>();
        // const task = async (): Promise<void> => {
        //     if (event.is_anonymous || event.user_id === undefined || event.user_name === undefined) {
        //         return;
        //     }
        //     const bidwarSpreadsheet = await getBidwarSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarTestSubSheet);
        //     bidwarSpreadsheet.addBitsToUser(event.user_id, event.user_name, event.bits, new Date(subscription.created_at));
        //     await pushBidwarSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarTestSubSheet, bidwarSpreadsheet);
        // }
        // this._taskQueue.addTask(task);
        // this._taskQueue.startQueue();

        // return future;
    }

    protected subIncentiveToChatMessage(currentSubPoints: number, requiredSubPoints: number, activity: string): void {
        `We are currently at ${currentSubPoints}/${requiredSubPoints} towards the current subgoal incentive. If that goal is met, I'll ${activity}`;
    }
}