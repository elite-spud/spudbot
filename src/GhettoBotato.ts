import { randomInt } from "crypto";
import { IChatWarriorState } from "./ChatWarrior";
import { IIrcBotAuxCommandGroupConfig, IPrivMessageDetail } from "./IrcBot";
import { ITwitchBotConnectionConfig, ITwitchUserDetail, TwitchBotBase } from "./TwitchBot";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface IChatWarriorUserDetail extends ITwitchUserDetail {
    chatWarriorState?: IChatWarriorState;
}

export function compareStrings(left: string, right: string): number { return left === right ? 0 : (left < right ? -1 : 1); }

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

    protected async handleEcho(messageDetails: IPrivMessageDetail): Promise<void> {
        if (!this.doesTriggerMatch(messageDetails, "!echo", false)) {
            return;
        }

        if (!messageDetails.message || !messageDetails.respondTo) {
            return;
        }

        const response = messageDetails.message.split(" ").slice(1).join(" ");
        this.chat(messageDetails.respondTo, response);
    }

    // TODO: implement this
    // protected handleEditCom(messageDetails: IPrivMessageDetail): void {
    // }

    protected async handleSlot(messageDetails: IPrivMessageDetail): Promise<void> {
        if (!this.doesTriggerMatch(messageDetails, "!slot", false)) {
            return;
        }

        if (!messageDetails.respondTo || !messageDetails.username) {
            return;
        }

        const roll = randomInt(6);
        const timeoutSeconds = randomInt(31) + 60;
        if (roll === 0) {
            this.chat(messageDetails.respondTo, "💥 BANG!!");
            this.timeout(messageDetails.respondTo, messageDetails.username, timeoutSeconds);
        } else {
            this.chat(messageDetails.respondTo, "Click...");
        }
    }

    protected async handleTimeout(messageDetails: IPrivMessageDetail): Promise<void> {
        if (!this.doesTriggerMatch(messageDetails, "!timeout", false)) {
            return;
        }

        if (!messageDetails.respondTo || !messageDetails.username) {
            return;
        }

        const roll = randomInt(6);
        const timeoutSeconds = randomInt(31) + 60;
        const text = roll === 0 ? "You asked for it..." 
            : roll === 1 ? "Taken down on the word Go!"
            : roll === 2 ? "Critical Hit!"
            : roll === 3 ? "You will be remembered..."
            : roll === 4 ? "You're welcome"
            : "In memoriam.";
        
        this.chat(messageDetails.respondTo, text);
        this.timeout(messageDetails.respondTo, messageDetails.username, timeoutSeconds);
    }

    protected async handleGiveaway(messageDetails: IPrivMessageDetail): Promise<void> {
        if (!this.doesTriggerMatch(messageDetails, "!giveaway", false)
            && !this.doesTriggerMatch(messageDetails, "!vacation", false)) {
            return;
        }

        if (!messageDetails.respondTo || !messageDetails.username) {
            return;
        }

        const roll = randomInt(5);
        const timeoutSeconds = 60 * 3;
        const text = roll === 0 ? "Enjoy your vacation!" 
            : roll === 1 ? "Thank you for flying with 'Tater Airlines, enjoy your trip!"
            : roll === 2 ? "You're a winner! Thanks for playing!"
            : roll === 3 ? "Jackpot!!"
            : "DING DING DING!!";
        
        this.chat(messageDetails.respondTo, text);
        this.timeout(messageDetails.respondTo, messageDetails.username, timeoutSeconds);
    }

    protected async handleUptime(messageDetails: IPrivMessageDetail): Promise<void> {
        if (!this.doesTriggerMatch(messageDetails, "git status", true)
            && !this.doesTriggerMatch(messageDetails, "!uptime", false)
            && !this.doesTriggerMatch(messageDetails, "!status", false)
            && !this.doesTriggerMatch(messageDetails, "!duration", false)) {
            return;
        }

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

            this.chat(messageDetails.respondTo, `This stream has been live for ${timeLiveStr}`);
        } catch (err) {
            this.chat(messageDetails.respondTo, `This stream is currently offline.`);
        }
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