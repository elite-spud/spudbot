import { JWT } from "google-auth-library";
import { google, sheets_v4 } from "googleapis";
import { Future } from "../Future";
import { PendingTask, PendingTaskGroup } from "../PendingTask";
import { TaskQueue } from "../TaskQueue";
import { TwitchApi } from "../TwitchApi";
import { TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Notification_Subscription } from "../TwitchApiTypes";
import { Bidwar_Spreadsheet } from "./spreadsheets/BidwarSpreadsheet";
import { pushSpreadsheet } from "./spreadsheets/SpreadsheetBase";
import { GameRequestEntry } from "./spreadsheets/gamerequest/GameRequestEntry";
import { GameRequest_Spreadsheet } from "./spreadsheets/gamerequest/google/GameRequestSpreadsheet";

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
    overfundingEnabled?: boolean,
}

export interface FundGameRequestOutcome {
    type: FundGameRequestOutcomeType;
    overfundedByAmount?: number;
    entry?: GameRequestEntry;
    complete?: () => Promise<void>;
}

export enum FundGameRequestOutcomeType {
    Fulfilled,
    Unfulfilled_NewRequest,
    Unfulfilled_OverfundDisabled,
    PendingConfirmation_OverfundNeedsApproval,
}

export class GoogleAPI {
    public static readonly incentiveSheetId = "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY";
    public static readonly gameRequestSubSheet = 384782784;
    public static readonly bidwarSubSheet = 877321766;
    public static readonly gameRequestInputSubSheet = this.gameRequestSubSheet;
    public static readonly gameRequestOutputSubSheet = this.gameRequestSubSheet;

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
        if (config.overfundingEnabled !== undefined) {
            this.setOverfundEnabled(config.overfundingEnabled);
        }
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
                const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
                await chat(`Game request refresh successfully completed.`);
                return;
            } catch (err) {
                const errorMessage = `Error handling game request refresh`;
                chat(errorMessage);
                throw err;
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
                const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
                const existingEntry = gameRequestSpreadsheet.findEntry(event.user_input);

                if (!existingEntry) {
                    chat(`@${event.user_name}, your new game request for ${event.user_input} was received. Please wait for an admin to add it to the spreadsheet before contributing any further points.`);
                    return;
                } else if (existingEntry.currentIteration.isCompleted) {
                    chat(`@${event.user_name}, your game request for ${event.user_input} was received. Please wait for an admin to reactivate it on the spreadsheet before contributing any points.`);
                    return;
                } else {
                    await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
                    chat(`@${event.user_name}, your request to add ${event.user_input} has been rejected because it already exists in the spreadsheet (${(existingEntry.percentageFunded * 100).toFixed(1)}% funded). Please try contributing points instead.`);
                    return;
                }
            } catch (err) {
                const chatErrorMessage = `Error handling game request add redemption`;
                chat(chatErrorMessage);
                throw err;
            } finally {
                future.resolve();
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestContributeRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, chat: (message: string) => Promise<void>, pendingTaskGroup: PendingTaskGroup): Promise<void> {
        const pendingConfirmationTimeoutMinutes = 1;
        const outcome = await this.handleGameRequestFund(event.user_input, event.user_name, event.user_id, event.reward.cost, new Date(event.redeemed_at));
        const getSuccessfullyFundedMessage = (outcome: FundGameRequestOutcome) => {
            const fundingStr = outcome.entry === undefined
            ? ``
            : outcome.entry.currentIteration.percentageFunded < 1.0
                ? `(${outcome.entry.currentIteration.effectivePoints}/${outcome.entry.currentIteration.pointsRequiredToFund})`
                : `(${(outcome.entry.currentIteration.percentageFunded * 100).toFixed(1)}% funded`;
            return `@${event.user_name}, added ${event.reward.cost} points to requesting ${event.user_input} on stream!${fundingStr}`;
        }
        
        if (outcome.type === FundGameRequestOutcomeType.Fulfilled) {
            await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, true);
            const successfullyFundedMessage = getSuccessfullyFundedMessage(outcome);
            chat(successfullyFundedMessage);
            return;
        }

        if (outcome.type === FundGameRequestOutcomeType.Unfulfilled_NewRequest) {
            await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
            chat(`@${event.user_name}, your game request was detected as a new request. Please redeem the "Submit a new !GameRequest" reward first in order to add it to the spreadsheet.`);
            return;
        }

        if (outcome.type === FundGameRequestOutcomeType.Unfulfilled_OverfundDisabled) {
            await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
            chat(`@${event.user_name}, you've submitted enough channel points to overfund the requested game, ${event.user_input} ${outcome.overfundedByAmount !== undefined ? `, by ${outcome.overfundedByAmount} points` : ``}, but overfunding is currently disabled. Your points have been returned.`);
            return;
        }

        if (outcome.type === FundGameRequestOutcomeType.PendingConfirmation_OverfundNeedsApproval && outcome.complete !== undefined) {
            chat(`@${event.user_name}, you've submitted enough channel points to overfund the requested game, ${event.user_input}${outcome.overfundedByAmount !== undefined ? `, by ${outcome.overfundedByAmount} points` : ``}. Are you sure you want to overfund this game? (respond with !yes or !no) This request will be automatically rejected in ${pendingConfirmationTimeoutMinutes} minute(s) without further input.`);
            const completeFunc = outcome.complete; // compiler wasn't inferring the right type without this
            const complete = async () => {
                try {
                    await completeFunc();
                    await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, true);
                } catch (err) {
                    const chatErrorMessage = `Error completing pending game request funding confirmation`;
                    chat(chatErrorMessage);
                    throw err;
                }
                const successfullyFundedMessage = getSuccessfullyFundedMessage(outcome);
                chat(successfullyFundedMessage);
            }
            const cancel = async () => {
                await this._config.twitchApi.updateChannelPointRedemption(event.id, event.reward.id, event.broadcaster_user_id, false);
                chat(`@${event.user_name} your ${event.reward.cost} points have been refunded.`);
            }
            const pendingTask = new PendingTask(complete, cancel);
            await pendingTaskGroup.setPendingTask(event.user_id, pendingTask, pendingConfirmationTimeoutMinutes * 60 * 1000);
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
    public async handleGameRequestFund(gameName: string, username: string, userId: string, points: number, timestamp: Date): Promise<FundGameRequestOutcome> {
        const future = new Future<FundGameRequestOutcome>();
        const task = async (): Promise<void> => {
            const gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
            const existingEntry = gameRequestSpreadsheet.findEntry(gameName);
            if (!existingEntry) {
                future.resolve({ type: FundGameRequestOutcomeType.Unfulfilled_NewRequest });
                return;
            }

            const completeFunding = async () => {
                gameRequestSpreadsheet.addPointsToEntry(username, userId, gameName, points, timestamp);
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
            }

            const notCurrentlyOverfunded = existingEntry.pointsContributed <= existingEntry.pointsRequiredToFund;
            const wouldBeOverfunded = existingEntry.pointsContributed + points > existingEntry.pointsRequiredToFund;
            if (notCurrentlyOverfunded && wouldBeOverfunded) {
                console.log("Overfunding detected!");
                const overfundedByAmount = existingEntry.pointsContributed + points - existingEntry.pointsRequiredToFund;
                if (!this.gameRequestOverfundingEnabled) {
                    console.log("Overfunding disabled!");
                    future.resolve({
                        type: FundGameRequestOutcomeType.Unfulfilled_OverfundDisabled,
                        overfundedByAmount: overfundedByAmount,
                    });
                    return;
                }

                future.resolve({
                    type: FundGameRequestOutcomeType.PendingConfirmation_OverfundNeedsApproval,
                    overfundedByAmount: overfundedByAmount,
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
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                future.resolve();
                throw err;
            }

            try {
                gameRequestSpreadsheet.addEntry(gameName, gameLengthHours, pointsToActivate, userId, username, points, timestamp);
            } catch (err) {
                const chatMessage = `Error adding game request ${gameName}`;
                chat(chatMessage);
                future.resolve();
                throw err;
            }

            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
                chat(`Game request ${gameName} successfully added.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error updating game request spreadsheet`;
                chat(chatMessage);
                future.resolve();
                throw err
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestSelect(gameName: string, timestamp: Date, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            let gameRequestSpreadsheet: GameRequest_Spreadsheet;
            try {
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                future.resolve();
                throw err;
            }

            try {
                gameRequestSpreadsheet.selectEntry(gameName, timestamp);
            } catch (err) {
                const chatMessage = `Error selecting game request`;
                chat(chatMessage);
                future.resolve();
                throw err;
            }

            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
                chat(`Game request ${gameName} successfully selected.`);
            } catch (err) {
                const chatMessage = `Error selecting game request ${gameName}. No data altered.`;
                chat(chatMessage);
                throw err;
            } finally {
                future.resolve();
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
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                future.resolve();
                throw err;
            }

            try {
                gameRequestSpreadsheet.startEntry(gameName, timestamp);
            } catch (err) {
                const chatMessage = `Error starting game request`;
                chat(chatMessage);
                future.resolve();
                throw err;
            }

            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
                chat(`Game request ${gameName} successfully started.`);
            } catch (err) {
                const chatMessage = `Error starting game request ${gameName}. No data altered.`;
                chat(chatMessage);
                throw err;
            } finally {
                future.resolve();
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
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                future.resolve();
                throw err;
            }

            try {
                gameRequestSpreadsheet.completeEntry(gameName, timestamp, hoursPlayed);
            } catch (err) {
                const chatMessage = `Error completing game request`;
                chat(chatMessage);
                future.resolve();
                throw err;
            }

            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
                chat(`Game request ${gameName} successfully completed.`);
            } catch (err) {
                const chatMessage = `Error completing game request ${gameName}. No data altered.`;
                chat(chatMessage);
                throw err;
            } finally {
                future.resolve();
            }
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    public async handleGameRequestReopen(gameName: string, gameLengthHours: number, pointsToActivate: number | undefined, userId: string, username: string, points: number, timestamp: Date, chat: (message: string) => Promise<void>): Promise<void> {
        const future = new Future<void>();
        const task = async (): Promise<void> => {
            let gameRequestSpreadsheet: GameRequest_Spreadsheet;
            try {
                gameRequestSpreadsheet = await GameRequest_Spreadsheet.getGameRequestSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestInputSubSheet, this.gameRequestOverfundingEnabled);
            } catch (err) {
                chat(`Failed to read game request spreadsheet. No data altered.`);
                future.resolve();
                throw err;
            }

            try {
                gameRequestSpreadsheet.startNewIteration(gameName, gameLengthHours, pointsToActivate, userId, username, points, timestamp);
            } catch (err) {
                const chatMessage = `Error reopening game request ${gameName}`;
                chat(chatMessage);
                future.resolve();
                throw err;
            }

            try {
                await pushSpreadsheet(await this._googleSheets, GoogleAPI.incentiveSheetId, GoogleAPI.gameRequestOutputSubSheet, gameRequestSpreadsheet);
                chat(`Game request ${gameName} successfully reopened.`);
                future.resolve();
            } catch (err) {
                const chatMessage = `Error updating game request spreadsheet`;
                chat(chatMessage);
                future.resolve();
                throw err
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
                throw err;
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
                throw err;
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
                throw err;
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
                throw err;
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