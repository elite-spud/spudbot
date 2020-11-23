import { randomInt } from "crypto";
import { IChatWarriorState } from "./ChatWarrior";
import { IIrcBotAuxCommandGroupConfig, IPrivMessageDetail, IUserDetails } from "./IrcBot";
import { ITwitchBotConnectionConfig, ITwitchUserDetail, TwitchBot } from "./TwitchBot";

export interface UserCommand {
    username: string,
    command: (data: string) => void,
}

export interface IChatWarriorUserDetail extends ITwitchUserDetail {
    chatWarriorState?: IChatWarriorState;
}

export function compareStrings(left: string, right: string): number { return left === right ? 0 : (left < right ? -1 : 1); }

export class GhettoBotatoTwitchBot extends TwitchBot<IChatWarriorUserDetail> {
    public constructor(connection: ITwitchBotConnectionConfig, auxCommandGroups: IIrcBotAuxCommandGroupConfig[], userDetails: IUserDetails<IChatWarriorUserDetail> ) {
        super(connection, auxCommandGroups, userDetails);
        this._hardcodedResponseHandlers.push((detail) => this.handleEcho(detail));
        this._hardcodedResponseHandlers.push((detail) => this.handleSlot(detail));
        this._hardcodedResponseHandlers.push((detail) => this.handleTimeout(detail));
        this._hardcodedResponseHandlers.push((detail) => this.handleGiveaway(detail));
    }

    protected handleEcho(messageDetails: IPrivMessageDetail): void {
        if (!this.doesTriggerMatch(messageDetails, "!echo", false)) {
            return;
        }

        if (!messageDetails.message || !messageDetails.recipient) {
            return;
        }

        const response = messageDetails.message.split(" ").slice(1).join(" ");
        this.chat(messageDetails.recipient, response);
    }

    // TODO: implement this
    // protected handleEditCom(messageDetails: IPrivMessageDetail): void {
    // }

    protected handleSlot(messageDetails: IPrivMessageDetail): void {
        if (!this.doesTriggerMatch(messageDetails, "!slot", false)) {
            return;
        }

        if (!messageDetails.recipient || !messageDetails.username) {
            return;
        }

        const roll = randomInt(6);
        const timeoutSeconds = randomInt(31) + 60;
        if (roll === 0) {
            this.chat(messageDetails.recipient, "💥 BANG!!");
            this.timeout(messageDetails.recipient, messageDetails.username, timeoutSeconds);
        } else {
            this.chat(messageDetails.recipient, "Click...");
        }
    }

    protected handleTimeout(messageDetails: IPrivMessageDetail): void {
        if (!this.doesTriggerMatch(messageDetails, "!timeout", false)) {
            return;
        }

        if (!messageDetails.recipient || !messageDetails.username) {
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
        
        this.chat(messageDetails.recipient, text);
        this.timeout(messageDetails.recipient, messageDetails.username, timeoutSeconds);
    }

    protected handleGiveaway(messageDetails: IPrivMessageDetail): void {
        if (!this.doesTriggerMatch(messageDetails, "!giveaway", false)
            || !this.doesTriggerMatch(messageDetails, "!vacation", false)) {
            return;
        }

        if (!messageDetails.recipient || !messageDetails.username) {
            return;
        }

        const roll = randomInt(5);
        const timeoutSeconds = 60 * 3;
        const text = roll === 0 ? "Enjoy your vacation!" 
            : roll === 1 ? "Thank you for flying with 'Tater Airlines, enjoy your trip!"
            : roll === 2 ? "You're a winner! Thanks for playing!"
            : roll === 3 ? "Jackpot!!"
            : "DING DING DING!!";
        
        this.chat(messageDetails.recipient, text);
        this.timeout(messageDetails.recipient, messageDetails.username, timeoutSeconds);
    }

    // protected handleStatus(messageDetails: IPrivMessageDetail): void {
    //     if (!this.doesTriggerMatch(messageDetails, "!status", false)
    //         || !this.doesTriggerMatch(messageDetails, "git status", false)) {
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