import { randomInt } from "crypto";
import { MessageHandler_InputRequired, MessageHandler_InputRequired_Config } from "./ChatCommand";
import { IMessageHandlerInput_Twitch } from "./ChatCommand_Twitch";
import * as fs from "fs";
import { TwitchApi } from "./TwitchApi";
import { SpudBotTwitch } from "./SpudBot";
import { Utils } from "./Utils";
import { egadd_quotes, f_zero_gx_interview_quotes, f_zero_gx_quotes, f_zero_gx_story_quotes, lm_quotes, luigi_quotes } from "./Quotes";
import { FundGameRequestOutcomeType, GoogleAPI } from "./google/GoogleAPI";
import { CreateCustomChannelPointRewardArgs, TwitchUserDetail } from "./TwitchApiTypes";
import { ChannelPointRequests } from "./ChannelPointRequests";

export interface SpudBot_MessageHandlers_Config {
    bonkCountFilePath: string;
    forRealCountFilePath: string;
    spudBot: SpudBotTwitch;
    twitchApi: Promise<TwitchApi>;
    googleApi: Promise<GoogleAPI>;
}

export class SpudBot_MessageHandlers {
    protected readonly _bonkCountFilePath: string;
    protected readonly _forRealCountFilePath: string;
    protected readonly _twitchApi: Promise<TwitchApi>;
    protected readonly _spudBot: SpudBotTwitch;
    protected readonly _googleApi: Promise<GoogleAPI>;

    public constructor(config: SpudBot_MessageHandlers_Config) {
        this._bonkCountFilePath = config.bonkCountFilePath;
        this._forRealCountFilePath = config.forRealCountFilePath;
        this._twitchApi = config.twitchApi;
        this._spudBot = config.spudBot;
        this._googleApi = config.googleApi;
    }

    public getHandlers() {
        const handlers = [
            this.getHandler_Echo(),
            this.getHandler_First(),
            this.getHandler_Bonk(),
            this.getHandler_ForReal(),
            this.getHandler_Slot(),
            this.getHandler_Flip(),
            this.getHandler_Timeout(),
            this.getHandler_Giveaway(),
            this.getHandler_Play(),
            this.getHandler_Uptime(),
            this.getHandler_LmQuote(),
            this.getHandler_EgaddQuote(),
            this.getHandler_LuigiQuote(),
            this.getHandler_FZeroGXStoryQuote(),
            this.getHandler_FZeroGXInterviewQuote(),
            this.getHandler_FZeroGXQuote(),
            this.getHandler_PowerupBidwarFunds(),
            // this.getHandler_UpdateAllUsers(),
            // this.getHandler_CreateGameRequestRewards(),
            this.getHandler_GameRequestModular(),
            // this.getHandler_BidwarModular(),
        ];
        return handlers;
    }

    protected getHandler_Echo(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const response = input.message.split(" ").slice(1).join(" "); // Trim the "!echo" off the front & send the rest along
            await input.chat(response);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!echo",
            triggerPhrases: ["!echo"],
            strictMatch: false, // echoing requires something after the command itself
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_First(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            let response: string;
            const someoneWasAlreadyFirst = !!this._spudBot._firstChatterName;
            if (this._spudBot._firstChatterName === input.username) {
                response = `Congrats, ${this._spudBot._firstChatterName}, you${someoneWasAlreadyFirst ? "'re" : " were"} first today!`;
            } else if (!this._spudBot._firstChatterName) {
                response = `No one is first yet...`;
            } else {
                response = `${this._spudBot._firstChatterName} was first today.`
            }
            await input.chat(response);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!first",
            triggerPhrases: ["!first"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    /**
     * Reads a count value from a file
     * @returns 
     */
    protected readCountFromFile(filepath: string): number {
        // if (!fs.existsSync(filepath)) {
        //     this.writeCountToFile(filepath, 0);
        // }
        const fileBuffer = fs.readFileSync(filepath);
        const fileStr = fileBuffer.toString("utf8");
        return Number.parseInt(fileStr) || 0;
    }

    /**
     * Writes a count value to a file
     */
    protected writeCountToFile(filepath: string, value: number): void {
        fs.writeFileSync(filepath, `${value}`);
    }

    protected getHandler_Bonk(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const count = this.readCountFromFile(this._bonkCountFilePath) + 1;
            this.writeCountToFile(this._bonkCountFilePath, count);
            const response = `${count} recorded bonks`;
            await input.chat(response);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!bonk",
            triggerPhrases: ["!bonk"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_ForReal(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const count = this.readCountFromFile(this._forRealCountFilePath) + 1;
            this.writeCountToFile(this._forRealCountFilePath, count);
            const response = `"FOR REAL" has been uttered ${count} times`;
            await input.chat(response);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!forreal",
            triggerPhrases: ["!forreal", "!ForReal", "!forReal", "!forREAL"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_Slot(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const twitchApi = await this._twitchApi;
            const roll = randomInt(3);
            const timeoutSeconds = (randomInt(10) + 1) * 20 + 60;
            if (roll !== 0) {
                const targetUser = await this._spudBot.getUserDetailForUserId(input.userId);
                await twitchApi.timeout(targetUser, timeoutSeconds);
                await input.chat("💥 BANG!!");
            } else {
                await input.chat("Click...");
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!slot",
            triggerPhrases: ["!slot"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_Flip(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const flip = randomInt(2);
            if (flip === 0) {
                await input.chat("Heads");
            } else {
                await input.chat("Tails");
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!flip",
            triggerPhrases: ["!flip"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_Timeout(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const timeoutSeconds = randomInt(120) + 240;
            const text = Utils.pickOne([
                "You asked for it..." ,
                "Critical Hit!",
                "You will be remembered...",
                "You're welcome",
                "Super Effective!",
                "Please come again",
                "In memoriam.",
                "This one's on the house.",
            ]);
            
            const twitchApi = await this._twitchApi;
            const targetUser = await this._spudBot.getUserDetailForUserId(input.userId);
            await twitchApi.timeout(targetUser, timeoutSeconds);
            await input.chat(text);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!timeout",
            triggerPhrases: ["!timeout"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_Giveaway(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const timeoutSeconds = (randomInt(5) + 1) * 60 + 60;
            const text = Utils.pickOne([
                "You've won a fabulous vacation, courtesy of 'Tater Airlines, enjoy your trip!",
                "Congratulations! You won an all-expenses paid trip to the gulag, enjoy your stay!",
                "You're a winner! Thanks for playing!",
                "Jackpot!!",
                "You're entitled to one (1) complimentary vacation. Enjoy the time off.",
                "DING DING DING!!",
            ]);
            
            const twitchApi = await this._twitchApi;
            const targetUser = await this._spudBot.getUserDetailForUserId(input.userId);
            await twitchApi.timeout(targetUser, timeoutSeconds);
            await input.chat(text);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!giveaway",
            triggerPhrases: ["!giveaway"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_Play(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const userIsBroadcaster = input.userIsBroadcaster;
            if (!userIsBroadcaster) {
                return;
            }
            await input.chat("!play");
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!play",
            triggerPhrases: ["!play"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_Uptime(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            try {
                const twitchApi = await this._twitchApi;
                const broadcasterId = await twitchApi.getTwitchBroadcasterId();
                const streamDetails = await twitchApi.getStreamDetails(broadcasterId);
                if (streamDetails === undefined) {
                    await input.chat(`This stream is not currently live.`);
                    return;
                }
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
    
                await input.chat(`This stream has been live for ${timeLiveStr}`);
            } catch (err) {
                await input.chat(`This stream is currently offline.`);
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!uptime",
            triggerPhrases: ["!uptime"],
            strictMatch: true,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_LmQuote(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const quoteIndex = randomInt(lm_quotes.length);
            const quoteText = lm_quotes[quoteIndex]!;
            await input.chat(quoteText);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!lmquote",
            triggerPhrases: ["!lmquote"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_EgaddQuote(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const quoteIndex = randomInt(egadd_quotes.length);
            const quoteText = egadd_quotes[quoteIndex]!;
            await input.chat(quoteText);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!egaddquote",
            triggerPhrases: ["!egaddquote"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_LuigiQuote(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const quoteIndex = randomInt(luigi_quotes.length);
            const quoteText = luigi_quotes[quoteIndex]!;
            await input.chat(quoteText);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!luigiquote",
            triggerPhrases: ["!luigiquote"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_FZeroGXStoryQuote(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const quoteIndex = randomInt(f_zero_gx_story_quotes.length);
            const quoteText = f_zero_gx_story_quotes[quoteIndex]!;
            await input.chat(quoteText);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!fzerogxstoryquote",
            triggerPhrases: ["!fzerogxstoryquote", "!gxstoryquote"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_FZeroGXInterviewQuote(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const quoteIndex = randomInt(f_zero_gx_interview_quotes.length);
            const quoteText = f_zero_gx_interview_quotes[quoteIndex]!;
            await input.chat(quoteText);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!fzerogxinterviewquote",
            triggerPhrases: ["!fzerogxinterviewquote", "!gxinterviewquote"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_FZeroGXQuote(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const quoteIndex = randomInt(f_zero_gx_quotes.length);
            const quoteText = f_zero_gx_quotes[quoteIndex]!;
            await input.chat(quoteText);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!fzerogxquote",
            triggerPhrases: ["!fzerogxquote", "!gxquote"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_PowerupBidwarFunds(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            if (!input.messageContainsGigantifiedEmote) {
                return;
            }
            if (!input.userIsBroadcaster) {
                return;
            }
            const powerupGigantifyBitsCost = await this._spudBot.getPowerupGigantifyBitsCost();
            await (await this._googleApi).handleBidwarAddFunds(input.userId, input.username, powerupGigantifyBitsCost, `Powerup: Gigantify`, new Date(), input.chat);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!powerupBidwar",
            triggerPhrases: undefined,
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_UpdateAllUsers(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            if (!input.userIsBroadcaster) {
                return;
            }
            await this._spudBot.updateAllUsers();
            await input.chat(`Successfully updated all cached users`);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!powerupBidwar",
            triggerPhrases: undefined,
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_CreateGameRequestRewards(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const twitchApi = await this._twitchApi;
            const existingRewards = await twitchApi.getChannelPointRewards();
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
                await twitchApi.createChannelPointReward(reward);
            }

            let message = `Custom channel point rewards initialized. Added ${newRewards.length - numSkippedAdditions} new rewards.`;
            if (numSkippedAdditions > 0) {
                message += ` Skipped ${numSkippedAdditions} new additions`;
            }
            input.chat(message);
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!initGameRequests",
            triggerPhrases: ["!initGameRequests"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_GameRequestModular(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const regex = /([^\s"]+|"[^"]*")+/g;
            const tokens = input.message.match(regex) ?? [];

            if (tokens.length <= 1) {
                return; // Defer to configured command
            }

            if (!input.userIsBroadcaster) { // TODO: detect streamer's name from config or make this a basic configuration with a name/broadcaster option
                input.chat(`only the broadcaster can use this command`);
                return;
            }
            if (tokens[1] === "help") {
                const adminHelpMessage = `!gamerequest [add, reopen, fund, select, start, complete, refresh]`;
                input.chat(adminHelpMessage);
                return;
            } else if (tokens[1] === "add") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!gamerequest add <gameName> <gameLengthHours> [pointsToActivate] <username> <points>`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                if (args.length === 4) {
                    const gameLengthHours = Number.parseInt(args[1]!);
                    const username = args[2]!;
                    const userId = await (await this._twitchApi).getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                    const pointsToApply = Number.parseInt(args[3]!);
                    await (await this._googleApi).handleGameRequestAdd(gameName, gameLengthHours, undefined, userId, username, pointsToApply, new Date(), input.chat);
                } else if (args.length === 5) {
                    const gameLengthHours = Number.parseInt(args[1]!);
                    const pointsToActivate = Number.parseInt(args[2]!);
                    const username = args[3]!;
                    const userId = await (await this._twitchApi).getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                    const pointsToApply = Number.parseInt(args[4]!);
                    await (await this._googleApi).handleGameRequestAdd(gameName, gameLengthHours, pointsToActivate, userId, username, pointsToApply, new Date(), input.chat);
                } else {
                    input.chat(`!gameRequest add command was malformed (expected at least 4 arguments, but found ${args.length})`);
                }
                } else if (tokens[1] === "reopen") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!gamerequest reopen <gameName> <gameLengthHours> [pointsToActivate] <username> <points>`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                if (args.length === 4) {
                    const gameLengthHours = Number.parseInt(args[1]!);
                    const username = args[2]!;
                    const userId = await (await this._twitchApi).getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                    const pointsToApply = Number.parseInt(args[3]!);
                    await (await this._googleApi).handleGameRequestReopen(gameName, gameLengthHours, undefined, userId, username, pointsToApply, new Date(), input.chat);
                } else if (args.length === 5) {
                    const gameLengthHours = Number.parseInt(args[1]!);
                    const pointsToActivate = Number.parseInt(args[2]!);
                    const username = args[3]!;
                    const userId = await (await this._twitchApi).getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                    const pointsToApply = Number.parseInt(args[4]!);
                    await (await this._googleApi).handleGameRequestReopen(gameName, gameLengthHours, pointsToActivate, userId, username, pointsToApply, new Date(), input.chat);
                } else {
                    input.chat(`!gameRequest reopen command was malformed (expected at least 4 arguments, but found ${args.length})`);
                }
            } else if (tokens[1] === "remove") {
                // TODO: implement this
            } else if (tokens[1] === "select") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!gamerequest select <gameName>`);
                    return;
                }
                if (args.length !== 1) {
                    input.chat(`!gameRequest select command was malformed (expected 1 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                await (await this._googleApi).handleGameRequestSelect(gameName, new Date(), input.chat);
            } else if (tokens[1] === "start") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!gamerequest start <gameName>`);
                    return;
                }
                if (args.length !== 1) {
                    input.chat(`!gameRequest start command was malformed (expected 1 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                await (await this._googleApi).handleGameRequestStart(gameName, new Date(), input.chat);
            } else if (tokens[1] === "complete") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!gamerequest complete <gameName> <hoursPlayed>`);
                    return;
                }
                if (args.length !== 2) {
                    input.chat(`!gameRequest complete command was malformed (expected 2 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                const hoursPlayed = Number.parseInt(args[1]!);
                await (await this._googleApi).handleGameRequestComplete(gameName, new Date(), hoursPlayed, input.chat);
            } else if (tokens[1] === "fund") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!gamerequest fund <gameName> <username> <points>`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                if (args.length === 3) {
                    const username = args[1]!;
                    const userId = await this._spudBot.getUserIdForUsername(username);
                    const pointsToApply = Number.parseInt(args[2]!);
                    const outcome = await (await this._googleApi).handleGameRequestFund(gameName, username, userId, pointsToApply, new Date());
                    if (outcome.type === FundGameRequestOutcomeType.Unfulfilled_OverfundDisabled) {
                        input.chat(`Unable to apply funds to game request ${gameName}: would overfund by ${outcome.overfundedByAmount}, but overfunding is disabled`);
                        return;
                    }
                    if (outcome.type === FundGameRequestOutcomeType.PendingConfirmation_OverfundNeedsApproval && outcome.complete !== undefined) {
                        console.log(`Forcing Overfund...`);
                        await outcome.complete(); // force this through
                    }
                    input.chat(`Game request funds added.`);
                }
            } else if (tokens[1] === "refresh") {
                await (await this._googleApi).handleGameRequestRefresh(input.chat);
            } else {
                input.chat(`unknown !gameRequest command ${tokens[1]}`);
                return;
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!gamerequest",
            triggerPhrases: ["!gamerequest", "!request", "!gameRequest", "!GameRequest"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    protected getHandler_BidwarModular(): MessageHandler_InputRequired<IMessageHandlerInput_Twitch> {
        const handleFunc = async (input: IMessageHandlerInput_Twitch) => {
            const regex = /([^\s"]+|"[^"]*")+/g;
            const tokens = input.message.match(regex) ?? [];

            const contributeHelpMessage = `!bidwar contribute "<gameName>" <amount>`;
            if (tokens.length <= 1) {
                return;
            }

            if (tokens[1] === "help") {
                const helpMessage = input.userIsBroadcaster
                    ? `!bidwar [contribute, remove, add, addFunds]`
                    : contributeHelpMessage;
                input.chat(helpMessage);
                return;
            }

            let userDetail: TwitchUserDetail | undefined;
            try {
                userDetail = await this._spudBot.getUserDetailForUserId(input.userId);
            } catch (err) {
                console.log(`Error retrieving userDetail for user: ${input.username} ${input.userId}`);
                console.log(err);
                return;
            }
            const messageSenderUserId = userDetail.id;

            if (tokens[1] === "contribute") {
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(contributeHelpMessage);
                    return;
                }
                if (args.length !== 2) {
                    input.chat(`!bidwar contribute was malformed (expected at least 2 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                const amount = Number.parseInt(args[1]!);
                await (await this._googleApi).handleBidwarContribute(messageSenderUserId, input.username, gameName, amount, new Date(), input.chat);
                return;
            }
            if (tokens[1] === "promote") {
                if (!input.userIsBroadcaster) {
                    input.chat(`only the broadcaster can use this command`);
                    return;
                }
                // TODO: implement this
                return;
            }
            if (tokens[1] === "add") {
                if (!input.userIsBroadcaster) {
                    input.chat(`only the broadcaster can use this command`);
                    return;
                }
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!bidwar add <gameName> <amount>`);
                    return;
                }
                if (args.length !== 2) {
                    input.chat(`!bidwar add was malformed (expected at least 2 arguments, but found ${args.length})`);
                    return;
                }
                const gameName = args[0]!.replaceAll("\"", "");
                await (await this._googleApi).handleBidwarAddEntry(gameName, input.chat);
                return;
            }
            if (tokens[1] === "addFunds") {
                if (!input.userIsBroadcaster) {
                    input.chat(`only the broadcaster can use this command`);
                    return;
                }
                const args = tokens.slice(2);
                if (args.length === 0) {
                    input.chat(`!bidwar addFunds <username> <amount> [reason]`);
                    return;
                }
                if (args.length < 2 || args.length > 3) {
                    input.chat(`!bidwar addFunds was malformed (expected 2-3 arguments, but found ${args.length})`);
                    return;
                }
                const amount = Number.parseInt(args[1]!);
                const username = args[0]!;
                let userId: string | undefined = undefined;
                try {
                    userId = await (await this._twitchApi).getUserIdForUsername(username);
                    if (!userId) {
                        return;
                    }
                } catch (err) {
                    input.chat(`Error retrieving username info for ${username}. Was the command formatted correctly?`);
                    return;
                }
                const source = args.length >= 3
                    ? args[2]!.replaceAll("\"", "")
                    : undefined;
                await (await this._googleApi).handleBidwarAddFunds(userId, username, amount, source, new Date(), input.chat);
                return;
            }
        };
        
        const config: MessageHandler_InputRequired_Config<IMessageHandlerInput_Twitch> = {
            handlerId: "!bidwar",
            triggerPhrases: ["!bidwar"],
            strictMatch: false,
            handleMessage: handleFunc,
        };
        const handler = new MessageHandler_InputRequired(config);
        return handler;
    }

    // protected async handleTitle(messageDetail: IPrivMessageDetail): Promise<void> {
    //     const messageHandler = async (_messageDetail: IPrivMessageDetail): Promise<void> => {
    //         const messageTags = this.parseTwitchMessageTags(messageDetail.tags);
    //         const userIsMod = messageTags.mod === "1";
    //         const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
    //         if (!userIsMod && !userIsBroadcaster) {
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} only moderators can use the !title command`);
    //             return;
    //         }

    //         const input = messageDetail.message.split(" ").slice(1).join(" ").trim(); // Trim the "!title" off the front & send the rest along
    //         if (input === "") {
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} title must consist of more than whitespace characters`);
    //             return;
    //         }
            
    //         try {
    //             await this.updateChannelTitle(input);
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} title updated successfully.`);
    //         } catch (err) {
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} unable to update title.`);
    //         }
    //     }
    //     const func = this.getCommandFunc({
    //         messageHandler: messageHandler,
    //         triggerPhrases: ["!title"],
    //         strictMatch: false, // !title requires something after the command itself
    //         commandId: "!title",
    //         globalTimeoutSeconds: 0,
    //         userTimeoutSeconds: 0,
    //     });
    //     await func(messageDetail);
    // }

    // protected async handleGame(messageDetail: IPrivMessageDetail): Promise<void> {
    //     const messageHandler = async (_messageDetail: IPrivMessageDetail): Promise<void> => {
    //         const messageTags = this.parseTwitchMessageTags(messageDetail.tags);
    //         const userIsMod = messageTags.mod === "1";
    //         const userIsBroadcaster = messageDetail.username === this.twitchChannelName;
    //         if (!userIsMod && !userIsBroadcaster) {
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} only moderators can use the !game command`);
    //             return;
    //         }

    //         const input = messageDetail.message.split(" ").slice(1).join(" "); // Trim the "!title" off the front & send the rest along
    //         try {
    //             await this.updateChannelGame(input);
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} game updated successfully.`);
    //         } catch (err) {
    //             this.chat(messageDetail.respondTo, `@${messageDetail.username} unable to update game.`);
    //         }
    //     }
    //     const func = this.getCommandFunc({
    //         messageHandler: messageHandler,
    //         triggerPhrases: ["!game"],
    //         strictMatch: false, // !game requires something after the command itself
    //         commandId: "!game",
    //         globalTimeoutSeconds: 0,
    //         userTimeoutSeconds: 0,
    //     });
    //     await func(messageDetail);
    // }

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