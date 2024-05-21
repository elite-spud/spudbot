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

export interface Bidwar_Spreadsheet {
    activeBlock: Bidwar_EntryBlock;
    pendingBlock: Bidwar_EntryBlock;
    bankBlock: Bidwar_BankEntryBlock;
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