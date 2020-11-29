import { randomInt } from "crypto";
import { IChatWarriorState } from "./ChatWarrior";
import { IIrcBotAuxCommandGroupConfig, IPrivMessageDetail } from "./IrcBot";
import { ITwitchBotConnectionConfig, ITwitchUserDetail, TwitchBotBase } from "./TwitchBot";
import { Utils } from "./Utils";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface IChatWarriorUserDetail extends ITwitchUserDetail {
    chatWarriorState?: IChatWarriorState;
}

export class GhettoBotatoTwitchBot extends TwitchBotBase<IChatWarriorUserDetail> {
    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], userDetailFilePath: string, chatHistoryFilePath: string) {
        super(connection, auxCommandGroups, userDetailFilePath, chatHistoryFilePath);
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleEcho(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleSlot(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleTimeout(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleGiveaway(detail));
        this._hardcodedPrivMessageResponseHandlers.push(async (detail) => await this.handleUptime(detail));
    }

    protected async createUserDetail(userId: string): Promise<IChatWarriorUserDetail> {
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

    protected async handleEcho(messageDetail: IPrivMessageDetail): Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const response = messageDetail.message.split(" ").slice(1).join(" ");
            this.chat(messageDetail.respondTo, response);
        }
        const func = this.getChatResponseFunc({
            subFunc,
            triggerPhrases: ["!echo"],
            strictMatch: true,
            commandKey: "!echo",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    // TODO: implement this
    // protected handleEditCom(messageDetails: IPrivMessageDetail): void {
    // }

    protected async handleSlot(messageDetail: IPrivMessageDetail): Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const roll = randomInt(3);
            const timeoutSeconds = randomInt(31) + 60;
            if (roll === 0) {
                this.chat(messageDetail.respondTo, "💥 BANG!!");
                this.timeout(messageDetail.respondTo, messageDetail.username, timeoutSeconds);
            } else {
                this.chat(messageDetail.respondTo, "Click...");
            }
        }
        const func = this.getChatResponseFunc({
            subFunc,
            triggerPhrases: ["!slot"],
            strictMatch: true,
            commandKey: "!slot",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleTimeout(messageDetail: IPrivMessageDetail): Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const timeoutSeconds = randomInt(31) + 60;
            const text = Utils.pickOne([
                "You asked for it..." ,
                'Taken down on the word "Go"!',
                "Critical Hit!",
                "You will be remembered...",
                "You're welcome",
                "Super Effective!",
                "Please come again",
                "In memoriam.",
            ]);
            
            this.chat(messageDetail.respondTo, text);
            this.timeout(messageDetail.respondTo, messageDetail.username, timeoutSeconds);
        }
        const func = this.getChatResponseFunc({
            subFunc,
            triggerPhrases: ["!timeout"],
            strictMatch: true,
            commandKey: "!timeout",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleGiveaway(messageDetail: IPrivMessageDetail): Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            const timeoutSeconds = 60 * 3;
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
        const func = this.getChatResponseFunc({
            subFunc,
            triggerPhrases: ["!giveaway", "!vacation"],
            strictMatch: false,
            commandKey: "!giveaway",
            globalTimeoutSeconds: 0,
            userTimeoutSeconds: 0,
        });
        await func(messageDetail);
    }

    protected async handleUptime(messageDetail: IPrivMessageDetail): Promise<void> {
        const subFunc = async (messageDetail: IPrivMessageDetail): Promise<void> => {
            try {
                const streamDetails = await this.getStreamDetails(this.twitchChannelName);
                const dateNowMillis = Date.now();
                const dateStarted = new Date(streamDetails.data[0].started_at);
                const dateStartedMillis = dateStarted.getTime();
                let dateDiff = dateStartedMillis - dateNowMillis;
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
        const func = this.getChatResponseFunc({
            subFunc,
            triggerPhrases: ["git status", "!uptime", "!status", "!duration"],
            strictMatch: true,
            commandKey: "!uptime",
            globalTimeoutSeconds: 10,
            userTimeoutSeconds: 120,
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