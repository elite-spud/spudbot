import { IChatWarriorState } from "./ChatWarrior";
import { GoogleAPIConfig } from "./GoogleAPI";
import { ITwitchBotConfig, ITwitchBotConnectionConfig, ITwitchUserDetail } from "./TwitchBotTypes";

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

export enum Bidwar_Spreadsheet_BlockOrder {
    Pending = 0,
    Active = 1,
    Bank = 2,
}

export class Bidwar_Spreadsheet {
    public readonly activeBlock: Bidwar_EntryBlock;
    public readonly pendingBlock: Bidwar_EntryBlock;
    public readonly bankBlock: Bidwar_BankEntryBlock;

    public constructor(activeBlock: Bidwar_EntryBlock, pendingBlock: Bidwar_EntryBlock, bankBlock: Bidwar_BankEntryBlock) {
        this.activeBlock = activeBlock;
        this.pendingBlock = pendingBlock;
        this.bankBlock = bankBlock;
    }

    public addBitsToUser(userId: string, username: string, bits: number, timestamp: Date): void {
        const user = this.bankBlock.entries.find(n => n.userId === userId);
        if (user === undefined) {
            const newBankUser: Bidwar_BankEntry = {
                userId: userId,
                name: username,
                points: bits,
                pointsNote: `${bits} - ${timestamp.toISOString()}`,
            };
            this.bankBlock.entries.push(newBankUser);
            return;
        }

        user.name = username;
        user.points = user.points += bits;
        user.pointsNote = `+ ${bits} - ${timestamp.toISOString()}\n${user.pointsNote}`;
    }

    
    public async addBitsToEntry(userId: string, username: string, gamename: string, bits: number, timestamp: Date): Promise<void> {
        if (bits === 0) {
            return;
        }

        const entry = this.activeBlock.entries.find(n => n.name.toLowerCase() === gamename.toLowerCase());
        const user = this.bankBlock.entries.find(n => n.userId === userId);

        if (!entry) {
            throw new Error(`Unable to find entry ${entry} in bidwar list`);
        }
        if (!user) {
            throw new Error(`User ${username} does not have enough points to fund the request (${0} / ${bits})`);
        }

        if (user.points < bits) {
            throw new Error(`User ${username} does not have enough points to fund the request (${user.points} / ${bits})`);
        }

        entry.points += bits;
        user.points -= bits;
        entry.pointsNote = `+ ${bits} - ${timestamp.toISOString()}\n${entry.pointsNote}`;
        user.pointsNote = `- ${bits} - ${timestamp.toISOString()}\n${user.pointsNote}`;
    }
}

export interface Bidwar_EntryBlockBase {
    header: (string | undefined)[];
    footer: (string | undefined)[];
}

export interface Bidwar_EntryBlock extends Bidwar_EntryBlockBase {
    entries: Bidwar_Entry[];
}

export interface Bidwar_Entry {
    name: string;
    points: number;
    pointsNote?: string;
    nameNote?: string;
}

export interface Bidwar_BankEntryBlock  extends Bidwar_EntryBlockBase {
    entries: Bidwar_BankEntry[];
}

export interface Bidwar_BankEntry {
    userId: string;
    name: string;
    points: number;
    pointsNote?: string;
}