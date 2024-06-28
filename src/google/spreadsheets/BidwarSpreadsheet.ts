import { sheets_v4 } from "googleapis";
import { borderLeft, getBorderRowBelow, headerFormatCenter, pendingEntryFormat } from "./GameRequestSpreadsheetStyle";
import { SpreadsheetBase, SpreadsheetBlock, SpreadsheetRow, extractBlockArray, formatTimestampForSpreadsheet, getEntryValue_String, headerToRowData, parseHeaderFooterRow } from "./SpreadsheetBase";

export enum Bidwar_Spreadsheet_BlockOrder {
    Pending = 0,
    Active = 1,
    Bank = 2,
}

export interface BidwarOperationStatus {
    success: boolean;
    message?: string;
}

export class Bidwar_Spreadsheet extends SpreadsheetBase {
    public readonly awaitingBlock: Bidwar_AwaitingBlock;
    public readonly activeBlock: Bidwar_ActiveBlock;
    public readonly bankBlock: Bidwar_BankBlock;

    public constructor(pendingBlock: Bidwar_AwaitingBlock, activeBlock: Bidwar_ActiveBlock, bankBlock: Bidwar_BankBlock) {
        super();
        this.activeBlock = activeBlock;
        this.awaitingBlock = pendingBlock;
        this.bankBlock = bankBlock;
    }

    public addBitsToUser(userId: string, username: string, bits: number, timestamp: Date, source?: string): void {
        const user = this.bankBlock.entries.find(n => n.userId === userId);
        if (user === undefined) {
            const newBankUser = new Bidwar_BankEntry({
                userId: userId,
                name: username,
                contributions: [{ amount: bits, timestamp: timestamp, detail: source }],
            });
            this.bankBlock.entries.push(newBankUser);
            return;
        }

        user.name = username;
        user.contributions.unshift({ amount: bits, timestamp: timestamp, detail: source });
    }
    
    public spendBitsOnEntry(userId: string, username: string, gameName: string, bits: number, timestamp: Date): BidwarOperationStatus {
        if (bits === 0) {
            return { success: false } ;
        }

        const entry = this.activeBlock.entries.find(n => n.name.toLowerCase() === gameName.toLowerCase());
        const user = this.bankBlock.entries.find(n => n.userId === userId);

        if (!entry) {
            return { success: false, message: `Unable to find entry ${gameName} in bidwar list. No bits added.` };
        }
        if (!user) {
            return { success: false, message: `User ${username} does not have enough points to fund the request (${0} / ${bits})` };
        }
        if (user.currentBalance < bits) {
            return { success: false, message: `User ${username} does not have enough points to fund the request (${user.currentBalance} / ${bits})` };
        }

        entry.contributions.unshift({ name: username, amount: bits });
        user.contributions.unshift({ amount: -bits, timestamp: timestamp, detail: `-> ${gameName}` });

        return { success: true };
    }

    public addEntry(gameName: string): BidwarOperationStatus {
        const existingEntry = this.activeBlock.entries.some(n => n.name === gameName);
        if (existingEntry) {
            return { success: false, message: `Existing entry found for game ${gameName} No new entry added.`};
        }
        
        const entry = new Bidwar_Entry({
            name: gameName,
            nameNote: undefined,
            contributions: [],
        });
        this.activeBlock.entries.push(entry);
        return { success: true };
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        let rowData: sheets_v4.Schema$RowData[] = [];
        if (this.awaitingBlock.entries.length !== 0) {
            rowData = rowData.concat(this.awaitingBlock.toRowData());
        }
        rowData = rowData.concat(this.activeBlock.toRowData()).concat(this.bankBlock.toRowData());
        return rowData;
    }

    public static async getBidwarSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetId: number): Promise<Bidwar_Spreadsheet> {
        const apiSpreadsheet = await sheetsApi.spreadsheets.getByDataFilter({
            spreadsheetId: sheetId,
            requestBody: {
                includeGridData: true,
                dataFilters: [
                    { gridRange: { sheetId: subSheetId } }
                ]
            }
        });
    
        if (!apiSpreadsheet.data || !apiSpreadsheet.data.sheets) {
            throw new Error("Unable to retrieve bidwar spreadsheet: sheet is empty");
        }
    
        const blockArray = extractBlockArray(apiSpreadsheet.data.sheets[0]);
        let awaitingBlock: Bidwar_AwaitingBlock | undefined = undefined;
        let activeBlock: Bidwar_ActiveBlock | undefined = undefined;
        let bankBlock: Bidwar_BankBlock | undefined = undefined;
        for (let i = 0; i < 3; i++) {
            if (i === Bidwar_Spreadsheet_BlockOrder.Pending) {
                awaitingBlock = parseBidwarAwaitingBlock(blockArray[i]);
            } else if (i === Bidwar_Spreadsheet_BlockOrder.Active) {
                activeBlock = parseBidwarActiveBlock(blockArray[i]);
            } else if (i === Bidwar_Spreadsheet_BlockOrder.Bank) {
                bankBlock = parseBidwarBankBlock(blockArray[i]);
            }
        }
    
        if (!awaitingBlock || !activeBlock || !bankBlock) {
            throw new Error("Unable to parse discrete blocks from bidwar spreadsheet");
        }
    
        const bidwarSpreadsheet = new Bidwar_Spreadsheet(awaitingBlock, activeBlock, bankBlock);
        return bidwarSpreadsheet;
    }
}

export class Bidwar_AwaitingBlock extends SpreadsheetBlock {
    public header: SpreadsheetRow;
    public entries: Bidwar_Entry[];

    public constructor(args: {
            header: SpreadsheetRow,
            entries: Bidwar_Entry[],
        }) {
        super();
        this.header = args.header;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRow = headerToRowData(this.header);
        const entryRows = this.entries.map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { numberValue: n.amountContributed },
                        note: n.contributions.sort((a, b) => b.amount - a.amount).map(c => `${c.name} - ${c.amount}`).join("\n"),
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { stringValue: n.name },
                        note: n.nameNote,
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    }
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows).concat(getBorderRowBelow(2));
    }
}

export class Bidwar_ActiveBlock extends SpreadsheetBlock {
    public header: SpreadsheetRow;
    public entries: Bidwar_Entry[];
    public footer: SpreadsheetRow;

    public constructor(args: {
            header: SpreadsheetRow,
            entries: Bidwar_Entry[],
            footer: SpreadsheetRow,
        }) {
        super();
        this.header = args.header;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRow = headerToRowData(this.header);
        const entryRows = this.entries.map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { numberValue: n.amountContributed },
                        note: n.contributions.sort((a, b) => b.amount - a.amount).map(c => `${c.name} - ${c.amount}`).join("\n"),
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { stringValue: n.name },
                        note: n.nameNote,
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    },
                ],
            };
            return rowData;
        });
        const totalContributions = this.entries.reduce<number>((prev, current, _index) => {
            return prev + current.amountContributed;
        }, 0);
        const footerRow: sheets_v4.Schema$RowData = {
            values: [
                {
                    userEnteredValue: { stringValue: `Total Bits: ${totalContributions}` },
                    userEnteredFormat: headerFormatCenter,
                },
                {
                    userEnteredFormat: headerFormatCenter,
                },
                {
                    userEnteredFormat: borderLeft,
                },
            ]
        }
        return [headerRow].concat(entryRows).concat(footerRow).concat(getBorderRowBelow(2));
    }
}

export interface Bidwar_EntryContribution {
    name: string;
    amount: number;
}

export class Bidwar_Entry {
    public readonly name: string;
    public readonly nameNote?: string;
    public readonly contributions: Bidwar_EntryContribution[];

    public constructor(args: {
        name: string,
        nameNote: string | undefined,
        contributions: { name: string, amount: number }[]
    }) {
        this.name = args.name;
        this.nameNote = args.nameNote;
        this.contributions = Array.from(args.contributions);
    }

    public get amountContributed(): number {
        return this.contributions.reduce<number>((prev, current, _index) => {
            return prev + current.amount;
        }, 0);
    }

    public static parseContributions(contributionsString: string): Bidwar_EntryContribution[] {
        if (!contributionsString) {
            return [];
        }
    
        const contributions = contributionsString.split("\n").map(n => { 
            const tokens = n.trim().split(/\s+/);
            const amount = Number.parseInt(tokens[0]);
            const name = tokens[2];
            const contribution: Bidwar_EntryContribution = { amount, name };
            return contribution;
        });
        return contributions;
    }
}

export class Bidwar_BankBlock extends SpreadsheetBlock {
    public header: SpreadsheetRow;
    public entries: Bidwar_BankEntry[];

    public constructor(args: {
            header: SpreadsheetRow,
            entries: Bidwar_BankEntry[],
        }) {
        super();
        this.header = args.header;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRow = headerToRowData(this.header);
        const entryRows = this.entries.map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { numberValue: n.currentBalance },
                        note: n.contributions.map(c => {
                            const timeString = c.timestamp
                                ? formatTimestampForSpreadsheet(c.timestamp)
                                : undefined
                            let contributionString = `${c.amount >= 0 ? "+" : ""}${c.amount}`;
                            if (timeString) {
                                contributionString += ` - ${timeString}`;
                            }
                            if (c.detail) {
                                contributionString += ` - ${c.detail}`;
                            }
                            return contributionString;
                        }).join("\n"),
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { stringValue: n.name },
                        note: n.userId,
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    },
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows).concat(getBorderRowBelow(2));
    }
}

export interface Bidwar_BankEntryContribution {
    amount: number,
    timestamp?: Date,
    detail?: string
};

export class Bidwar_BankEntry {
    public readonly userId: string;
    public name: string;
    public readonly contributions: Bidwar_BankEntryContribution[];
    
    public constructor(args: {
        userId: string,
        name: string,
        contributions: Bidwar_BankEntryContribution[]
    }) {
        this.userId = args.userId;
        this.name = args.name;
        this.contributions = Array.from(args.contributions);
    }

    public get currentBalance(): number {
        return this.contributions.reduce<number>((prev, current, _index) => {
            return prev + current.amount;
        }, 0);
    }

    public static parseContributions(contributionsString: string): Bidwar_BankEntryContribution[] {
        if (!contributionsString) {
            return [];
        }
    
        const contributions = contributionsString.split("\n").map(n => { 
            const tokens = n.trim().split(/\s+/);
            const amount = Number.parseInt(tokens[0]);
            const timestamp = tokens.length >= 3 ? new Date(tokens[2]) : undefined;
            let detail = tokens.length >= 5 ? tokens[4] : undefined;
            const contribution: Bidwar_BankEntryContribution = { amount, timestamp, detail };
            return contribution;
        });
        return contributions;
    }
}

export function parseBidwarEntry(row: sheets_v4.Schema$RowData): Bidwar_Entry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const contributionsString = row.values[0].note ?? "";
    const contributions = Bidwar_Entry.parseContributions(contributionsString);
    const entry = new Bidwar_Entry({
        contributions: contributions,
        name: getEntryValue_String(row.values[1]),
        nameNote: row.values[1].note ?? undefined,
    });
    return entry;
}

export function parseBidwarBankEntry(row: sheets_v4.Schema$RowData): Bidwar_BankEntry {
    if (!row.values) {
        throw new Error("Expected bank entry row to have values");
    }

    const contributionsString = row.values[0].note ?? "";
    const contributions = Bidwar_BankEntry.parseContributions(contributionsString);
    const bankEntry = new Bidwar_BankEntry({
        userId: row.values[1].note ?? "",
        name: getEntryValue_String(row.values[1]),
        contributions: contributions,
    });
    return bankEntry;
}

export function parseBidwarAwaitingBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_AwaitingBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: Bidwar_Entry[] = [];
    for (let i = 1; i < rows.length; i++) {
        const entry = parseBidwarEntry(rows[i]);
        entries.push(entry);
    }
    
    const pendingBlock = new Bidwar_AwaitingBlock({
        header: headerRow,
        entries: entries,
    });
    return pendingBlock;
}

export function parseBidwarActiveBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_ActiveBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: Bidwar_Entry[] = [];
    for (let i = 1; i < rows.length - 1; i++) {
        const entry = parseBidwarEntry(rows[i]);
        entries.push(entry);
    }

    const footerRow = parseHeaderFooterRow(rows[rows.length - 1]);
    
    const activeBlock = new Bidwar_ActiveBlock({
        header: headerRow,
        entries: entries,
        footer: footerRow,
    });
    return activeBlock;
}

export function parseBidwarBankBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_BankBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: Bidwar_BankEntry[] = [];
    for (let i = 1; i < rows.length; i++) {
        const entry = parseBidwarBankEntry(rows[i]);
        entries.push(entry);
    }
    
    const bankBlock = new Bidwar_BankBlock({
        header: headerRow,
        entries: entries,
    });
    return bankBlock;
}
