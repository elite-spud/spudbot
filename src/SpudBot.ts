import { randomInt } from "crypto";
import * as fs from "fs";
import { ChannelPointRequests } from "./ChannelPointRequests";
import { IChatWarriorState } from "./ChatWarrior";
import { Future } from "./Future";
import { GoogleAPI, GoogleAPIConfig } from "./GoogleAPI";
import { IIrcBotAuxCommandGroupConfig, IPrivMessageDetail } from "./IrcBot";
import { egadd_quotes, f_zero_gx_interview_quotes, f_zero_gx_quotes, f_zero_gx_story_quotes, luigi_quotes } from "./Quotes";
import { ITwitchBotConfig, ITwitchBotConnectionConfig, ITwitchUserDetail, TwitchBotBase, TwitchEventSubSubscriptionType, TwitchEventSub_ChannelPointCustomRewardRedemptionAdd } from "./TwitchBot";
import { Utils } from "./Utils";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface IChatWarriorUserDetail extends ITwitchUserDetail {
    chatWarriorState?: IChatWarriorState;
}

export interface ISpudBotConfig extends ITwitchBotConfig {
    connection: ISpudBotConnectionConfig;
}

export interface ISpudBotConnectionConfig extends ITwitchBotConnectionConfig {
    google: GoogleAPIConfig;
}

export class SpudBotTwitch extends TwitchBotBase<IChatWarriorUserDetail> {
    public declare readonly _config: ISpudBotConfig;
    protected readonly _bonkCountPath: string;
    protected _firstName: string | undefined = undefined;
    protected _recentMessageCapsPercentages: { [userName: string]: number[] } = {};
    protected _capsMessageWarnings: { [userName: string]: Date | undefined } = {};

    protected override getServiceName(): string { return "SpudBot" }
    protected readonly _googleApi = new Future<GoogleAPI>();

    public constructor(connection: ISpudBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], configDir: string) {
        super(connection, auxCommandGroups, configDir);
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleEcho(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleFirst(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleSlot(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleTimeout(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleGiveaway(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handlePlay(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleUptime(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleBonk(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleEgaddQuote(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleLuigiQuote(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleFZeroGXStoryQuote(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleFZeroGXInterviewQuote(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleFZeroGXQuote(detail));

        try {
            this._bonkCountPath = fs.realpathSync(`${this._config.configDir}/bonkCount.txt`);
        } catch (err) {
            // TODO: make sure the error is because the file doesn't exist yet
            fs.writeFileSync(`${this._config.configDir}/bonkCount.txt`, "0");
            this._bonkCountPath = fs.realpathSync(`${this._config.configDir}/bonkCount.txt`);
        }
    }

    public override async _startup(): Promise<void> {
        await super._startup();

        const googleApi = new GoogleAPI(this._config.connection.google);
        await googleApi.startup();
        this._googleApi.resolve(googleApi);

        await googleApi.testGoogleApi();
    }

    protected override async getTwitchBroadcasterId(): Promise<string> {
        return "47243772"; // TODO: make this dynamic
    }

    protected override async getTwitchEventSubTopics(): Promise<TwitchEventSubSubscriptionType[]> {
        return [{
            name: `channel.channel_points_custom_reward_redemption.add`,
            version: `1`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }, {
            name: `channel.channel_points_custom_reward_redemption.update`,
            version: `1`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }, {
            name: `channel.cheer`,
            version: `1`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }, {
            name: `channel.subscribe`,
            version: `1`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }, {
            name: `channel.subscription.gift`,
            version: `1`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }, {
            name: `channel.subscription.message`,
            version: `1`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }, {
            name: `channel.raid`,
            version: `1`,
            condition: {
                to_broadcaster_user_id: await this.getTwitchBroadcasterId(),
            }
        }];
    }

    protected override async handleChannelPointRewardRedeem(event: TwitchEventSub_ChannelPointCustomRewardRedemptionAdd): Promise<void> {
        // TODO: Make this a config file
        if (event.reward.title === "Hi, I'm Lurking!") {
            this.chat(`#${event.broadcaster_user_name}`, `${event.user_name}, enjoy your lurk elites72Heart`);
        }

        if (event.reward.title.includes("Contribute to a !GameRequest")) {
            await ChannelPointRequests.handleChannelPointGameRequest(event);
        }
    }

    /**
     * Reads the bonk count value from a file
     * @returns 
     */
    protected readBonkCount(): number {
        const fileBuffer = fs.readFileSync(this._bonkCountPath);
        const fileStr = fileBuffer.toString("utf8");
        return Number.parseInt(fileStr) || 0;
    }

    protected async getBonkCount(): Promise<number> {
        return this.readBonkCount();
    }

    /**
     * Writes the bonk count value to a file
     */
    protected writeBonkCount(value: number): void {
        fs.writeFileSync(this._bonkCountPath, `${value}`);
    }

    protected async setBonkCount(value: number): Promise<void> {
        this.writeBonkCount(value);
        return;
    }

    protected createFreshUserDetail(username: string, userId: string): IChatWarriorUserDetail {
        const twitchUserDetail: ITwitchUserDetail = {
            id: userId,
            username: username,
            secondsInChat: 0,
            numChatMessages: 0,
        };
        return twitchUserDetail;
    }

    protected async handleEcho(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const response = messageDetail.message.split(" ").slice(1).join(" "); // Trim the "!echo" off the front & send the rest along
            this.chat(messageDetail.respondTo, response);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!echo"],
            strictMatch: false, // echoing requires something after the command itself
            commandId: "!echo",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleFirst(messageDetail: IPrivMessageDetail): Promise<void> {
        const broadcasterName = this._config.connection.server.channel.substring(1);
        if (!this._firstName && messageDetail.username !== broadcasterName) {
            this._firstName = messageDetail.username;
        }
        
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            let response: string;
            const someoneWasAlreadyFirst = !!this._firstName;
            if (this._firstName === messageDetail.username) {
                response = `Congrats, ${this._firstName}, you${someoneWasAlreadyFirst ? "'re" : " were"} first today!`;
            } else if (!this._firstName) {
                response = `No one is first yet...`;
            } else {
                response = `${this._firstName} was first today.`
            }
            this.chat(messageDetail.respondTo, response);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!first"],
            strictMatch: false,
            commandId: "!first",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleCapsWarning(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            let upperCaseCount = 0;
            for (let i = 0; i < messageDetail.message.length; i++) {
                const letter = messageDetail.message.charAt(i);
                if (letter === letter.toUpperCase()) {
                    upperCaseCount++;
                }
            }
            const upperCasePercentage = upperCaseCount / messageDetail.message.length;

            if (this._recentMessageCapsPercentages[messageDetail.username] === undefined) {
                this._recentMessageCapsPercentages[messageDetail.username] = [];
            }
            const hasWarning = this._capsMessageWarnings[messageDetail.username] !== undefined;
            const fiveMinutesInMillis = 5 * 60 * 1000;
            if (hasWarning && Date.now() > this._capsMessageWarnings[messageDetail.username]!.getTime() + fiveMinutesInMillis) {
                this._capsMessageWarnings[messageDetail.username] = undefined;
            }

            const maxCount = 7;
            this._recentMessageCapsPercentages[messageDetail.username].push(upperCasePercentage);
            if (this._recentMessageCapsPercentages[messageDetail.username].length > maxCount) {
                this._recentMessageCapsPercentages[messageDetail.username].splice(0, 1);
            }
            const recentPercentage = this._recentMessageCapsPercentages[messageDetail.username].reduce((prev, value) => prev + value, 0) / maxCount;
            if (recentPercentage > 0.8 && upperCasePercentage > 0.8) {
                this._recentMessageCapsPercentages[messageDetail.username] = [];

                // TODO: Disable after a raid
                this._capsMessageWarnings[messageDetail.username] = new Date(Date.now());
                const response = `@${messageDetail.username} please don't use caps lock`;
                this.chat(messageDetail.respondTo, response);
            }
        }

        await messageHandler(messageDetail);
    }

    protected async handleBonk(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const bonkCount = await this.getBonkCount() + 1;
            await this.setBonkCount(bonkCount);
            const response = `${bonkCount} recorded bonks`;
            this.chat(messageDetail.respondTo, response);
        };
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!bonk"],
            strictMatch: true,
            commandId: "!bonk",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    // TODO: implement this
    // protected handleEditCom(messageDetails: IPrivMessageDetail): void {
    // }

    protected async handleSlot(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const roll = randomInt(3);
            const timeoutSeconds = (randomInt(10) + 1) * 20 + 60;
            if (roll !== 0) {
                this.chat(messageDetail.respondTo, "💥 BANG!!");
                this.timeout(messageDetail.respondTo, messageDetail.username, timeoutSeconds);
            } else {
                this.chat(messageDetail.respondTo, "Click...");
            }
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!slot"],
            strictMatch: true,
            commandId: "!slot",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleTimeout(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const timeoutSeconds = randomInt(120) + 240;
            const text = Utils.pickOne([
                "You asked for it..." ,
                'Taken down on the word "Go"!',
                "Critical Hit!",
                "You will be remembered...",
                "You're welcome",
                "Super Effective!",
                "Please come again",
                "In memoriam.",
                "This one's on the house.",
            ]);
            
            this.chat(messageDetail.respondTo, text);
            this.timeout(messageDetail.respondTo, messageDetail.username, timeoutSeconds);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!timeout"],
            strictMatch: true,
            commandId: "!timeout",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleGiveaway(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const timeoutSeconds = (randomInt(5) + 1) * 60 + 60;
            const text = Utils.pickOne([
                "You've won a fabulous vacation, courtesy of 'Tater Airlines, enjoy your trip!",
                "Congratulations! You won an all-expenses paid trip to the gulag, enjoy your stay!",
                "You're a winner! Thanks for playing!",
                "Jackpot!!",
                "You're entitled to one (1) complimentary vacation. Enjoy the time off.",
                "DING DING DING!!",
            ]);
            
            this.chat(messageDetail.respondTo, text);
            this.timeout(messageDetail.respondTo, messageDetail.username, timeoutSeconds);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!giveaway", "!vacation"],
            strictMatch: false,
            commandId: "!giveaway",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handlePlay(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            if (messageDetail.username !== "elite_spud") { // TODO: detect streamer's name from conifg or make this a basic configuration with a name/broadcaster option
                return;
            }
            this.chat(messageDetail.respondTo, "!play");
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!play"],
            strictMatch: false,
            commandId: "!play",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleUptime(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            try {
                const streamDetails = await this.getStreamDetails(this.twitchChannelName);
                const dateNowMillis = Date.now();
                const dateStarted = new Date(streamDetails.started_at);
                const dateStartedMillis = dateStarted.getTime();
                let dateDiff = dateNowMillis - dateStartedMillis;
                const days = Math.floor(dateDiff / (1000 * 60 * 60 * 24));
                dateDiff -=  days * (1000 * 60 * 60 * 24);
                const hours = Math.floor(dateDiff / (1000 * 60 * 60));
                dateDiff -= hours * (1000 * 60 * 60);
                const mins = Math.floor(dateDiff / (1000 * 60));
                dateDiff -= mins * (1000 * 60);
                const seconds = Math.floor(dateDiff / (1000));
                dateDiff -= seconds * (1000);
                const timeLiveStr = `${days ? `${days} day${days > 1 ? `s` : ``}` : ``} ${hours ? `${hours} hour${days > 1 ? `s` : ""}` : ``} ${mins ? `${mins} minute${mins > 1 ? `s` : ""}` : ``} ${seconds ? `${seconds} second${seconds > 1 ? `s` : ``}` : ``}`;
    
                this.chat(messageDetail.respondTo, `This stream has been live for ${timeLiveStr}`);
            } catch (err) {
                this.chat(messageDetail.respondTo, `This stream is currently offline.`);
            }           
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["git status", "!uptime", "!status", "!duration"],
            strictMatch: true,
            commandId: "!uptime",
            globalTimeoutSeconds: 10,
            userTimeoutSeconds: 120,
        });
        await func(messageDetail);
    }

    protected async handleEgaddQuote(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const quoteIndex = randomInt(egadd_quotes.length);
            const quoteText = egadd_quotes[quoteIndex];
            this.chat(messageDetail.respondTo, quoteText);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!egaddquote"],
            strictMatch: false,
            commandId: "!egaddquote",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleLuigiQuote(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const quoteIndex = randomInt(luigi_quotes.length);
            const quoteText = luigi_quotes[quoteIndex];
            this.chat(messageDetail.respondTo, quoteText);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!luigiquote"],
            strictMatch: false,
            commandId: "!luigiquote",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleFZeroGXStoryQuote(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const quoteIndex = randomInt(f_zero_gx_story_quotes.length);
            const quoteText = f_zero_gx_story_quotes[quoteIndex];
            this.chat(messageDetail.respondTo, quoteText);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!fzerogxstoryquote", "!gxstoryquote"],
            strictMatch: false,
            commandId: "!fzerogxstoryquote",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleFZeroGXInterviewQuote(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const quoteIndex = randomInt(f_zero_gx_interview_quotes.length);
            const quoteText = f_zero_gx_interview_quotes[quoteIndex];
            this.chat(messageDetail.respondTo, quoteText);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!fzerogxinterviewquote", "!gxinterviewquote"],
            strictMatch: false,
            commandId: "!fzerogxinterviewquote",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleFZeroGXQuote(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const quoteIndex = randomInt(f_zero_gx_quotes.length);
            const quoteText = f_zero_gx_quotes[quoteIndex];
            this.chat(messageDetail.respondTo, quoteText);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!fzerogxquote", "!gxquote"],
            strictMatch: false,
            commandId: "!fzerogxquote",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    // protected handleStatus(messageDetails: IPrivMessageDetail): void {
    //     if (!this.doesTriggerMatch(messageDetails, "!status", false)
    //         && !this.doesTriggerMatch(messageDetails, "git status", false)) {
    //         return;
    //     }

    //     if (!messageDetails.recipient || !messageDetails.username) {
    //         return;
    //     }

    //     let roll = randomInt(100);
    //     if (roll < 60) { // Good

    //     } else if (roll < 90) { // Mild

    //     } else { // Oh fuk
    //         const timeoutSeconds = randomInt(31) + 60;
    //         const phrases = [
                
    //         ]
    //         roll = randomInt(100);
    //         if (roll < 10) {
    //             this.chat(messageDetails.recipient, `${messageDetails.username} fainted!`);
    //             this.timeout(messageDetails.recipient, messageDetails.username, timeoutSeconds);
    //         } else if (roll < 20) {
    //             this.chat(messageDetails.recipient, `${messageDetails.username} could not grasp the true nature of Giygas' attack!`);
    //             this.timeout(messageDetails.recipient, messageDetails.username, timeoutSeconds);
    //         } else if (roll < 30) {

    //         }
    //     }
    // }
}