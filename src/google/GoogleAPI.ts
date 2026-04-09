import { JWT } from "google-auth-library";
import { google, sheets_v4 } from "googleapis";
import { Future } from "../Future";
import { PendingTask, PendingTaskGroup } from "../PendingTask";
import { TaskQueue } from "../TaskQueue";
import { TwitchApi } from "../TwitchApi";
import { TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Notification_Subscription } from "../TwitchApiTypes";
import { Bidwar_Spreadsheet } from "./spreadsheets/BidwarSpreadsheet";
import { GameRequest_Spreadsheet } from "./spreadsheets/GameRequestSpreadsheet";
import { pushSpreadsheet } from "./spreadsheets/SpreadsheetBase";

export interface GoogleApiConnectionConfig {
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

export interface GoogleApiConfig {
    connection: GoogleApiConnectionConfig,
    twitchApi: TwitchApi,
}

export interface FundGameRequestOutcome {
    type: FundGameRequestOutcomeType,
    overfundAmount?: number,
    complete?: () => Promise<void>,
}

export enum FundGameRequestOutcomeType {
    Fulfilled,
    Unfulfilled,
    PendingConfirmation,
}

export class GoogleAPI {
    public static readonly incentiveSheetId = "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY";
    public static readonly gameRequestSubSheet = 384782784;
    public static readonly bidwarSubSheet = 877321766;
    
    protected _gameRequestOverfundingEnabled: boolean = false;
    public get gameRequestOverfundingEnabled(): boolean {
        return this._gameRequestOverfundingEnabled;
    }
    protected readonly _config: GoogleApiConfig
    public readonly _googleSheets = new Future<sheets_v4.Sheets>();

    protected _taskQueue: TaskQueue = new TaskQueue();
    public readonly heldTasksByUserId: PendingTaskGroup = new PendingTaskGroup();

    public constructor(config: GoogleApiConfig) { // TODO: make a singleton?
        this._config = config;
    }

    public async startup(): Promise<void> {
        const client = new JWT({
            email: this._config.connection.jwt.client_email,
            key: this._config.connection.jwt.private_key,
            scopes: ["https://www.googleapis.com/auth/drive"],
        });

        const sheets = google.sheets({
            version: 'v4',
            auth: await client,
        });

        this._googleSheets.resolve(sheets);
    }

    public setOverfundEnabled(enable: boolean) {
        this._gameRequestOverfundingEnabled = enable;
    }

    public async handleGameRequestRefresh(chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            try {
                const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet);
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet, gameRequestSpreadsheet);
                await chat(`Game request successfully completed.`);
                return;
            } catch (err) {
                const errorMessage = `Error handling game request refresh: ${err.message}`;
                throw new Error(errorMessage);
            } finally {
                future.resolve();
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestAddRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, chat: (message: string) => Promise<void>) : Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            try {
                const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet);
                const existingEntry = gameRequestSpreadsheet.findEntry(event.user_input);
                if (!existingEntry) {
                    chat(`@${event.user_name}, your new game request was received. Please wait for an admin to add it to the spreadsheet before contributing any further points.`);
                    return;
                } else {
                    await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
                    chat(`@${event.user_name}, your request to add ${event.user_input} has been rejected because it already exists in the spreadsheet (${(existingEntry.percentageFunded * 100).toFixed(1)}% funded). Please consider contributing points instead.`);
                    return;
                }
            } catch (err) {
                const errorMessage = `Error handling game request add redemption: ${err.message}`;
                throw new Error(errorMessage);
            } finally {
                future.resolve();
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestContributeRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, chat: (message: string) => Promise<void>, pendingTaskGroup: PendingTaskGroup): Promise<void> {
        const outcome = await this.handleGameRequestFund(event.user_input, event.user_name, event.reward.cost, new Date(event.redeemed_at), chat);
        if (outcome.type === FundGameRequestOutcomeType.Fulfilled) {
            await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, true);
            return;
        }

        if (outcome.type === FundGameRequestOutcomeType.Unfulfilled) {
            await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
            return;
        }

        if (outcome.type === FundGameRequestOutcomeType.PendingConfirmation && outcome.complete !== undefined) {
            const timeoutMinutes = 1;
            chat(`@${event.user_name}, you've submitted enough channel points to overfund the requested game, ${event.user_input}${outcome.overfundAmount ? `, by ${outcome.overfundAmount} points` : ``}. Are you sure you want to overfund this game? (respond with !yes or !no) This request will be automatically rejected in ${timeoutMinutes} minute(s) without further input.`);
            const outcomeComplete = outcome.complete; // compiler wasn't inferring the right type without this
            const complete = async () => {
                await outcomeComplete();
                await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, true);
            }
            const cancel = async () => {
                await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
                chat(`@${event.user_name} your ${event.reward.cost} points have been refunded.`);
            }
            const pendingTask = new PendingTask(complete, cancel);
            await pendingTaskGroup.setPendingTask(event.user_id, pendingTask, timeoutMinutes * 60 * 1000);
            return;
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
    public async handleGameRequestFund(gameName: string, username: string, points: number, timestamp: Date, chat: (message: string) => Promise<void>): Promise<FundGameRequestOutcome> {
        const future = new Future<FundGameRequestOutcome>();
        const task = async (): Promise<void> => {
            const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet);
            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (!existingEntry) {
                chat(`@${username}, your game request was detected as a new request. Please redeem the "Submit a new !GameRequest" reward first in order to add it to the spreadsheet.`);
                future.resolve({ type: FundGameRequestOutcomeType.Unfulfilled });
                return;
            }

            const completeFunding = async () => {
                gameRequestSpreadsheet.addPointsToEntry(username, gameName, points, timestamp);
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet, gameRequestSpreadsheet);
                const entry = gameRequestSpreadsheet.findEntry(gameName);
                let fundingStr = ``;
                if (entry) {
                    fundingStr = entry.percentageFunded <= 1.0
                        ? ` (${entry.effectivePoints}/${entry.pointsRequiredToFund} points)`
                        : ` (${(entry.percentageFunded * 100).toFixed(1)}% funded)`;
                }
                chat(`@${username}, added ${points} points to requesting ${gameName} on stream!${fundingStr}`);
            }

            const notCurrentlyOverfunded = existingEntry.pointsContributed <= existingEntry.pointsRequiredToFund;
            const wouldBeOverfunded = existingEntry.pointsContributed + points > existingEntry.pointsRequiredToFund;
            if (notCurrentlyOverfunded && wouldBeOverfunded) {
                if (!this.gameRequestOverfundingEnabled) {
                    chat(`@${username}, you've submitted enough channel points to overfund the requested game, ${gameName} by ${existingEntry.pointsContributed + points - existingEntry.pointsRequiredToFund} points, but overfunding is currently disabled. Your points have been returned`);
                    future.resolve({ type: FundGameRequestOutcomeType.Unfulfilled });
                    return;
                }

                future.resolve({
                    type: FundGameRequestOutcomeType.PendingConfirmation,
                    overfundAmount: existingEntry.pointsContributed + points - existingEntry.pointsRequiredToFund,
                    complete: completeFunding,
                });
                return;
            }

            await completeFunding();
            future.resolve({ type: FundGameRequestOutcomeType.Fulfilled });
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestAdd(gameName: string, gameLengthHours: number, pointsToActivate: number | undefined, userId: string, username: string, points: number, timestamp: Date, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            let gameRequestSpreadsheet: GameRequest_Spreadsheet;
            try {
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                console.log(err);
                future.resolve();
                return;
            }

            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (existingEntry) {
                chat(`Game request already present in spreadsheet.`);
                future.resolve();
                return;
            }
            
            gameRequestSpreadsheet.addEntry(gameName, gameLengthHours, pointsToActivate, userId, username, points, timestamp);
            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet, gameRequestSpreadsheet);
                chat(`Game request successfully added.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error adding new game request`;
                chat(chatMessage);
                const errorMessage = `${chatMessage}: ${err.message}`;
                future.resolve();
                throw new Error(errorMessage);
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestStart(gameName: string, timestamp: Date, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            let gameRequestSpreadsheet: GameRequest_Spreadsheet;
            try {
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                console.log(err);
                future.resolve();
                return;
            }

            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (!existingEntry) {
                chat(`Game request "${gameName}" was not found in spreadsheet.`);
                future.resolve();
                return;
            }
            if (existingEntry.isCompleted) {
                chat(`Game request "${gameName}" has already been completed.`);
                future.resolve();
                return;
            }
            if (existingEntry.isStarted) {
                chat(`Game request "${gameName}" has already been started.`);
                future.resolve();
                return;
            }
            if (!existingEntry.isFunded) {
                chat(`Game request "${gameName}" has not yet been funded.`);
                future.resolve();
                return;
            }

            try {
                gameRequestSpreadsheet.startEntry(gameName, timestamp);
            } catch (err) {
                chat(`Error starting game request: ${err.message}`);
                future.resolve();
                return;
            }

            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet, gameRequestSpreadsheet);
                chat(`Game request successfully started.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error starting game request. No data altered.`;
                chat(chatMessage);
                const errorMessage = `${chatMessage}: ${err.message}`;
                future.resolve();
                throw new Error(errorMessage);
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestComplete(gameName: string, timestamp: Date, hoursPlayed: number, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            let gameRequestSpreadsheet: GameRequest_Spreadsheet;
            try {
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                console.log(err);
                future.resolve();
                return;
            }

            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (!existingEntry) {
                chat(`Game request "${gameName}" was not found in spreadsheet.`);
                future.resolve();
                return;
            }
            if (existingEntry.isCompleted) {
                chat(`Game request "${gameName}" has already been completed.`);
                future.resolve();
                return;
            }
            if (!existingEntry.isStarted) {
                chat(`Game request "${gameName}" has not yet been started.`);
                future.resolve();
                return;
            }
            
            try {
                gameRequestSpreadsheet.completeEntry(gameName, timestamp, hoursPlayed);
            } catch (err) {
                chat(`Error completing game request: ${err.message}`);
                future.resolve();
                return;
            }
            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestSubSheet, gameRequestSpreadsheet);
                chat(`Game request successfully completed.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error completing game request. No data altered.`;
                chat(chatMessage);
                const errorMessage = `${chatMessage}: ${err.message}`;
                future.resolve();
                throw new Error(errorMessage);
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleCheer(event: TwitchEventSub_Event_Cheer, subscription: TwitchEventSub_Notification_Subscription, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            if (event.is_anonymous || event.user_id === undefined || event.user_name === undefined) {
                future.resolve();
                return;
            }
            try {
                const bidwarSpreadsheet = await Bidwar_Spreadsheet.getBidwarSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet);
                bidwarSpreadsheet.addBitsToUser(event.user_id, event.user_name, event.bits, new Date(subscription.created_at), event.message);
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet, bidwarSpreadsheet);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error handling cheer event`;
                chat(`${chatMessage}`);
                future.resolve();
                const errorMessage = `${chatMessage}: ${err.message}`;
                throw new Error(errorMessage);
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleBidwarContribute(userId: string, username: string, gameName: string, bits: number, timestamp: Date, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            try {
                const bidwarSpreadsheet = await Bidwar_Spreadsheet.getBidwarSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet);
                const status = bidwarSpreadsheet.spendBitsOnEntry(userId, username, gameName, bits, timestamp);
                if (status.message) {
                    chat(status.message);
                }
                if (!status.success) {
                    future.resolve();
                    return;
                }
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet, bidwarSpreadsheet);
                chat(`@${username}, your bits were successfully contributed to ${gameName}.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error handling bidwar contribution`;
                chat(`${chatMessage}`);
                future.resolve();
                const errorMessage = `${chatMessage}: ${err.message}`;
                throw new Error(errorMessage);
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleBidwarAddEntry(gameName: string, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            try {
                const bidwarSpreadsheet = await Bidwar_Spreadsheet.getBidwarSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet);
                const status = bidwarSpreadsheet.addEntry(gameName);
                if (!status.success && status.message) {
                    chat(status.message);
                    future.resolve();
                    return;
                }
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet, bidwarSpreadsheet);
                chat(`Bidwar entry ${gameName} was successfully added.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error adding a new bidwar entry`;
                chat(`${chatMessage}`);
                future.resolve();
                const errorMessage = `${chatMessage}: ${err.message}`;
                throw new Error(errorMessage);
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleBidwarAddFunds(userId: string, username: string, amount: number, source: string | undefined, timestamp: Date, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            try {
                const bidwarSpreadsheet = await Bidwar_Spreadsheet.getBidwarSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet);
                bidwarSpreadsheet.addBitsToUser(userId, username, amount, timestamp, source ?? `manually added by admin`);
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.bidwarSubSheet, bidwarSpreadsheet);
                // this._config.twitchBot.chat(respondTo, `User ${username} had ${amount} added to their bidwar bank balance.`);
            } catch (err) {
                const chatMessage = `Error adding funds to bidwar bank balance`;
                await chat(`${chatMessage}`);
                const errorMessage = `${chatMessage}: ${err.message}`;
                throw new Error(errorMessage);
            } finally {
                future.resolve();
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    protected subIncentiveToChatMessage(currentSubPoints: number, requiredSubPoints: number, activity: string): void {
        `We are currently at ${currentSubPoints}/${requiredSubPoints} towards the current subgoal incentive. If that goal is met, I'll ${activity}`;
    }
}