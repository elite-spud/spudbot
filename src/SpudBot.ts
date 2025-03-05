import { randomInt } from "crypto";
import * as fs from "fs";
import { ChannelPointRequests } from "./ChannelPointRequests";
import { Future } from "./Future";
import { IIrcBotAuxCommandGroupConfig, IIrcBotMiscConfig, IPrivMessageDetail, IUserDetailCollection } from "./IrcBot";
import { egadd_quotes, f_zero_gx_interview_quotes, f_zero_gx_quotes, f_zero_gx_story_quotes, luigi_quotes } from "./Quotes";
import { ChatWarriorUserDetail, IChatWarriorUserDetail, ISpudBotConfig, ISpudBotConnectionConfig } from "./SpudBotTypes";
import { TwitchBotBase } from "./TwitchBot";
import { CreateCustomChannelPointRewardArgs, TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, TwitchEventSub_Event_Cheer, TwitchEventSub_Notification_Subscription, TwitchEventSub_SubscriptionType } from "./TwitchBotTypes";
import { Utils } from "./Utils";
import { FundGameRequestOutcomeType, GoogleAPI } from "./google/GoogleAPI";

export class SpudBotTwitch extends TwitchBotBase<ChatWarriorUserDetail> {
    public declare readonly _config: ISpudBotConfig;
    protected readonly _bonkCountPath: string;
    protected _firstChatterName: string | undefined = undefined;
    protected _recentMessageCapsPercentages: { [userName: string]: number[] } = {};
    protected _capsMessageWarnings: { [userName: string]: Date | undefined } = {};

    protected override getServiceName(): string { return "SpudBot" }
    protected readonly _googleApi = new Future<GoogleAPI>();

    public override get powerupGigantifyBitsCost(): number {
        return 10;
    }

    public constructor(miscConfig: IIrcBotMiscConfig, connection: ISpudBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], configDir: string) {
        super(miscConfig, connection, auxCommandGroups, configDir);
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
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleCreateGameRequestRewards(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleGameRequestModular(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleBidwarModular(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleYes(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleNo(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleUpdateAllUsers(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleTitle(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleGame(detail));

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

        const googleApi = new GoogleAPI(this._config.connection.google, this);
        await googleApi.startup();
        this._googleApi.resolve(googleApi);
    }

    protected override async getTwitchBroadcasterId(): Promise<string> {
        return "47243772"; // TODO: make this dynamic (i.e. not elite_spud)
    }

    protected override async getTwitchEventSubTopics(): Promise<TwitchEventSub_SubscriptionType[]> {
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
            name: `channel.subscription.end`,
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
        },{
            name: `channel.follow`,
            version: `2`,
            condition: {
                broadcaster_user_id: await this.getTwitchBroadcasterId(),
                moderator_user_id: await this.getTwitchBroadcasterId(), // TODO: make this use the chatbot id (must first use a token authorized by the chatbot account)
            }
        }];
    }

    protected override async handleCheer(event: TwitchEventSub_Event_Cheer, subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        await super.handleCheer(event, subscription);
        (await this._googleApi).handleCheer(event, subscription);
    }

    protected override async handleChannelPointRewardRedeem(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd, _subscription: TwitchEventSub_Notification_Subscription): Promise<void> {
        // TODO: Make this a config file
        if (event.reward.title === "Hi, I'm Lurking!") {
            this.chat(`#${event.broadcaster_user_name}`, `${event.user_name}, enjoy your lurk elites72Heart`);
        }

        if (event.reward.title.includes("Contribute to a !GameRequest")) {
            await (await this._googleApi).handleGameRequestContributeRedeem(event);
        }

        if (event.reward.title === "Submit a new !GameRequest") {
            await (await this._googleApi).handleGameRequestAddRedeem(event);
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

    protected override createFreshUserDetail(username: string, userId: string): ChatWarriorUserDetail {
        const twitchUserDetail: ChatWarriorUserDetail = new ChatWarriorUserDetail({
            id: userId,
            username: username,
            secondsInChat: 0,
            numChatMessages: 0,
        });
        return twitchUserDetail;
    }

    protected override createUserCollection(jsonCollection: IUserDetailCollection<IChatWarriorUserDetail>): IUserDetailCollection<ChatWarriorUserDetail> {
        const collection: IUserDetailCollection<ChatWarriorUserDetail> = {};
        for (const userId in jsonCollection) {
            const jsonDetail = jsonCollection[userId];
            const detail = new ChatWarriorUserDetail(jsonDetail);
            collection[userId] = detail;
        }
        return collection;
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
        if (!this._firstChatterName && messageDetail.username !== broadcasterName) {
            this._firstChatterName = messageDetail.username;
        }
        
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            let response: string;
            const someoneWasAlreadyFirst = !!this._firstChatterName;
            if (this._firstChatterName === messageDetail.username) {
                response = `Congrats, ${this._firstChatterName}, you${someoneWasAlreadyFirst ? "'re" : " were"} first today!`;
            } else if (!this._firstChatterName) {
                response = `No one is first yet...`;
            } else {
                response = `${this._firstChatterName} was first today.`
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
                this.timeout(messageDetail.respondTo.replace("#", ""), messageDetail.username, timeoutSeconds);
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
            this.timeout(messageDetail.respondTo.replace("#", ""), messageDetail.username, timeoutSeconds);
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
            this.timeout(messageDetail.respondTo.replace("#", ""), messageDetail.username, timeoutSeconds);
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
            const userIsBroadcaster = messageDetail.username === this.twitchChannelName
            if (!userIsBroadcaster) { // TODO: detect streamer's name from config or make this a basic configuration with a name/broadcaster option
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

    protected async handleCreateGameRequestRewards(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (_messageDetail: IPrivMessageDetail): Promise<void> => {
            const existingRewards = await this.getChannelPointRewards();
            const newRewards: CreateCustomChannelPointRewardArgs[] = [
                {
                    title: "Submit a new !GameRequest",
                    cost: ChannelPointRequests.getGameRequestPrice(0),
                    prompt: "Please provide the name of the game you'd like me to play. I manually review each request to determine how long it will take and how many points the request will cost to fund.",
                    background_color: "#196719",
                    is_user_input_required: true,
                    is_max_per_user_per_stream_enabled: true,
                    max_per_user_per_stream: 2,
                },
                {
                    title: "Contribute to a !GameRequest (1K)",
                    cost: 1000,
                    prompt: "Please provide the name of the game you'd like me to play. Points will be automatically added toward any existing request matching that name, so please ensure correct spelling.",
                    background_color: "#196719",
                    is_user_input_required: true,
                    is_max_per_user_per_stream_enabled: true,
                    max_per_user_per_stream: 5,
                },
                {
                    title: "Contribute to a !GameRequest (5K)",
                    cost: 5000,
                    prompt: "Please provide the name of the game you'd like me to play. Points will be automatically added toward any existing request matching that name, so please ensure correct spelling.",
                    background_color: "#196719",
                    is_user_input_required: true,
                    is_max_per_user_per_stream_enabled: true,
                    max_per_user_per_stream: 5,
                },
                {
                    title: "Contribute to a !GameRequest (25K)",
                    cost: 25000,
                    prompt: "Please provide the name of the game you'd like me to play. Points will be automatically added toward any existing request matching that name, so please ensure correct spelling.",
                    background_color: "#196719",
                    is_user_input_required: true,
                    is_max_per_user_per_stream_enabled: true,
                    max_per_user_per_stream: 4,
                },
                {
                    title: "Contribute to a !GameRequest (100K)",
                    cost: 100000,
                    prompt: "Please provide the name of the game you'd like me to play. Points will be automatically added toward any existing request matching that name, so please ensure correct spelling.",
                    background_color: "#196719",
                    is_user_input_required: true,
                    is_max_per_user_per_stream_enabled: true,
                    max_per_user_per_stream: 100,
                }
            ];

            let numSkippedAdditions = 0;
            for (const reward of newRewards) {
                if (existingRewards.some(n => n.title === reward.title)) {
                    numSkippedAdditions++;
                    continue;
                }
                await this.createChannelPointReward(reward);
            }

            let message = `Custom channel point rewards initialized. Added ${newRewards.length - numSkippedAdditions} new rewards.`;
            if (numSkippedAdditions > 0) {
                message += ` Skipped ${numSkippedAdditions} new additions`;
            }
            this.chat(messageDetail.respondTo, message);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!initGameRequests"],
            strictMatch: false,
            commandId: "!initGameRequests",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleGameRequestModular(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const regex = /([^\s"]+|"[^"]*")+/g;
            const tokens = messageDetail.message.match(regex) ?? [];

            if (tokens.length <= 1) {
                return; // Defer to configured command
            }

            const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
            if (!userIsBroadcaster) { // TODO: detect streamer's name from config or make this a basic configuration with a name/broadcaster option
                this.chat(messageDetail.respondTo, `only the broadcaster can use this command`);
                return;
            }

            if (tokens[1] === "help") {
                const adminHelpMessage = `!gamerequest [add, fund, start, complete]`;
                this.chat(messageDetail.respondTo, adminHelpMessage);
                return;
            }
            else if (tokens[1] === "add") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, `!gamerequest add <gameName> <gameLengthHours> [pointsToActivate] <username> <points>`);
                    return;
                }
                const gameName = args[0].replaceAll("\"", "");
                if (args.length === 4) {
                    const username = args[2];
                    const userId = await this.getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                    await (await this._googleApi).handleGameRequestAdd(messageDetail.respondTo, gameName, Number.parseInt(args[1]), undefined, userId, username, Number.parseInt(args[3]), new Date());
                } else if (args.length === 5) {
                    const username = args[3];
                    const userId = await this.getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                    await (await this._googleApi).handleGameRequestAdd(messageDetail.respondTo, gameName, Number.parseInt(args[1]), Number.parseInt(args[2]), userId, username, Number.parseInt(args[4]), new Date());
                } else {
                    this.chat(messageDetail.respondTo, `!gameRequest add command was malformed (expected at least 4 arguments, but found ${args.length})`);
                }
            } else if (tokens[1] === "remove") {
                // TODO: implement this
            } else if (tokens[1] === "start") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, `!gamerequest start <gameName>`);
                    return;
                }
                if (args.length !== 1) {
                    this.chat(messageDetail.respondTo, `!gameRequest complete command was malformed (expected 1 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0].replaceAll("\"", "");
                await (await this._googleApi).handleGameRequestStart(messageDetail.respondTo, gameName, new Date());
            } else if (tokens[1] === "complete") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, `!gamerequest complete <gameName> <hoursPlayed>`);
                    return;
                }
                if (args.length !== 2) {
                    this.chat(messageDetail.respondTo, `!gameRequest complete command was malformed (expected 2 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0].replaceAll("\"", "");
                const hoursPlayed = Number.parseInt(args[1]);
                await (await this._googleApi).handleGameRequestComplete(messageDetail.respondTo, gameName, new Date(), hoursPlayed);
            } else if (tokens[1] === "fund") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, `!gamerequest fund <gameName> <username> <points>`);
                    return;
                }
                const gameName = args[0].replaceAll("\"", "");
                if (args.length === 3) {
                    const outcome = await (await this._googleApi).handleGameRequestFund(messageDetail.respondTo, gameName, args[1], Number.parseInt(args[2]), new Date());
                    if (outcome.type === FundGameRequestOutcomeType.PendingConfirmation && outcome.complete !== undefined) {
                        await outcome.complete(); // force this through
                    }
                }
            } else {
                this.chat(messageDetail.respondTo, `unknown !gameRequest command ${tokens[1]}`);
                return;
            }
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!gamerequest"],
            strictMatch: false, // requesting a game requires input after the command
            commandId: "!gamerequest",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleBidwarModular(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const regex = /([^\s"]+|"[^"]*")+/g;
            const tokens = messageDetail.message.match(regex) ?? [];

            const userIsBroadcaster = messageDetail.username === this.twitchChannelName; // TODO: detect streamer's name from config or make this a basic configuration with a name/broadcaster option
            const contributeHelpMessage = `!bidwar contribute "<gameName>" <amount>`;
            if (tokens.length <= 1) {
                return;
            }

            if (tokens[1] === "help") {
                const helpMessage = userIsBroadcaster
                    ? `!bidwar [contribute, remove, add, addFunds]`
                    : contributeHelpMessage;
                this.chat(messageDetail.respondTo, helpMessage);
                return;
            }

            let userDetail: ChatWarriorUserDetail | undefined;
            try {
                userDetail = await this.getUserDetailWithCache(messageDetail.username);
            } catch (err) {
                console.log(`Error retrieving userDetail for user: ${messageDetail.username}`);
                console.log(err);
                return;
            }
            const messageSenderUserId = userDetail.id;

            if (tokens[1] === "contribute") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, contributeHelpMessage);
                    return;
                }
                if (args.length !== 2) {
                    this.chat(messageDetail.respondTo, `!bidwar contribute was malformed (expected at least 2 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0].replaceAll("\"", "");
                const amount = Number.parseInt(args[1]);
                await (await this._googleApi).handleBidwarContribute(messageDetail.respondTo, messageSenderUserId, messageDetail.username, gameName, amount, new Date());
                return;
            }
            if (tokens[1] === "promote") {
                if (!userIsBroadcaster) {
                    this.chat(messageDetail.respondTo, `only the broadcaster can use this command`);
                    return;
                }
                // TODO: implement this
                return;
            }
            if (tokens[1] === "add") {
                if (!userIsBroadcaster) {
                    this.chat(messageDetail.respondTo, `only the broadcaster can use this command`);
                    return;
                }
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, `!bidwar add <gameName> <amount>`);
                    return;
                }
                if (args.length !== 2) {
                    this.chat(messageDetail.respondTo, `!bidwar add was malformed (expected at least 2 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0].replaceAll("\"", "");
                await (await this._googleApi).handleBidwarAddEntry(messageDetail.respondTo, gameName);
                return;
            }
            if (tokens[1] === "addFunds") {
                if (!userIsBroadcaster) {
                    this.chat(messageDetail.respondTo, `only the broadcaster can use this command`);
                    return;
                }
                const args = tokens.slice(2);
                if (args.length === 0) {
                    this.chat(messageDetail.respondTo, `!bidwar addFunds <username> <amount> [reason]`);
                    return;
                }
                if (args.length < 2 || args.length > 3) {
                    this.chat(messageDetail.respondTo, `!bidwar addFunds was malformed (expected 2-3 arguments, but found ${args.length})`);
                    return;
                }
                const amount = Number.parseInt(args[1]);
                const username = args[0];
                let userId: string | undefined = undefined;
                try {
                    userId = await this.getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                } catch (err) {
                    this.chat(messageDetail.respondTo, `Error retrieving username info for ${username}. Was the command formatted correctly?`);
                    return;
                }
                const source = args.length >= 3
                    ? args[2].replaceAll("\"", "")
                    : undefined;
                await (await this._googleApi).handleBidwarAddFunds(messageDetail.respondTo, userId, username, amount, source, new Date());
                return;
            }
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!bidwar"],
            strictMatch: false,
            commandId: "!bidwar",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleYes(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const userId = await this.getUserIdForUsername(messageDetail.username);
            if (!userId) {
                return;
            }
            await this.heldTasksByUserId.complete(userId);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!yes"],
            strictMatch: true,
            commandId: "!yes",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleNo(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const userId = await this.getUserIdForUsername(messageDetail.username);
            if (!userId) {
                return;
            }
            await this.heldTasksByUserId.cancel(userId);
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!no"],
            strictMatch: true,
            commandId: "!no",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected override async handleMessagePowerup(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            if (this.emoteWasGigantified(messageDetail)) {
                const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
                if (userIsBroadcaster) { // Broadcasters Do not spend bits to redeem powerups on their own channel, so we should not add bits to the bidwar bank.
                    return;
                }
                const userId = await this.getUserIdForUsername(messageDetail.username);
                if (!userId) {
                    return;
                }
                await (await this._googleApi).handleBidwarAddFunds(messageDetail.respondTo, userId, messageDetail.username, this.powerupGigantifyBitsCost, `Powerup: Gigantify`, new Date());
            }
        }

        await messageHandler(messageDetail);
    }

    protected async handleUpdateAllUsers(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (_messageDetail: IPrivMessageDetail): Promise<void> => {
            const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
            if (!userIsBroadcaster) {
                return;
            }
            await this.updateAllUsers();
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!updateAllUsers"],
            strictMatch: true,
            commandId: "!updateAllUsers",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleTitle(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (_messageDetail: IPrivMessageDetail): Promise<void> => {
            const messageTags = this.parseTwitchMessageTags(messageDetail.tags);
            const userIsMod = messageTags.mod === "1";
            const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
            if (!userIsMod && !userIsBroadcaster) {
                this.chat(messageDetail.respondTo, `@${messageDetail.username} only moderators can use the !title command`);
                return;
            }

            const input = messageDetail.message.split(" ").slice(1).join(" ").trim(); // Trim the "!title" off the front & send the rest along
            if (input === "") {
                this.chat(messageDetail.respondTo, `@${messageDetail.username} title must consist of more than whitespace characters`);
                return;
            }
            
            try {
                await this.updateChannelTitle(input);
                this.chat(messageDetail.respondTo, `@${messageDetail.username} title updated successfully.`);
            } catch (err) {
                this.chat(messageDetail.respondTo, `@${messageDetail.username} unable to update title.`);
            }
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!title"],
            strictMatch: false, // !title requires something after the command itself
            commandId: "!title",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleGame(messageDetail: IPrivMessageDetail): Promise<void> {
        const messageHandler = async (_messageDetail: IPrivMessageDetail): Promise<void> => {
            const messageTags = this.parseTwitchMessageTags(messageDetail.tags);
            const userIsMod = messageTags.mod === "1";
            const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
            if (!userIsMod && !userIsBroadcaster) {
                this.chat(messageDetail.respondTo, `@${messageDetail.username} only moderators can use the !game command`);
                return;
            }

            const input = messageDetail.message.split(" ").slice(1).join(" "); // Trim the "!title" off the front & send the rest along
            try {
                await this.updateChannelGame(input);
                this.chat(messageDetail.respondTo, `@${messageDetail.username} game updated successfully.`);
            } catch (err) {
                this.chat(messageDetail.respondTo, `@${messageDetail.username} unable to update game.`);
            }
        }
        const func = this.getCommandFunc({
            messageHandler: messageHandler,
            triggerPhrases: ["!game"],
            strictMatch: false, // !game requires something after the command itself
            commandId: "!game",
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