import { sheets_v4 } from "googleapis";
import { SpreadsheetBlock, SpreadsheetRow, extractBlockArray, getEntryValue_Number, getEntryValue_String, headerToRowData, parseHeaderFooterRow } from "./SpreadsheetBase";

export enum Bidwar_Spreadsheet_BlockOrder {
    Pending = 0,
    Active = 1,
    Bank = 2,
}

export class Bidwar_Spreadsheet {
    public readonly activeBlock: Bidwar_ActiveBlock;
    public readonly pendingBlock: Bidwar_PendingBlock;
    public readonly bankBlock: Bidwar_BankBlock;

    public constructor(activeBlock: Bidwar_ActiveBlock, pendingBlock: Bidwar_PendingBlock, bankBlock: Bidwar_BankBlock) {
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

    
    public addBitsToEntry(userId: string, username: string, gamename: string, bits: number, timestamp: Date): void {
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

export class Bidwar_PendingBlock extends SpreadsheetBlock {
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
                        userEnteredValue: { numberValue: n.points },
                        note: n.pointsNote,
                    },
                    {
                        userEnteredValue: { stringValue: n.name },
                        note: n.nameNote,
                    },
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows);
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
                        userEnteredValue: { numberValue: n.points },
                        note: n.pointsNote,
                    },
                    {
                        userEnteredValue: { stringValue: n.name },
                        note: n.nameNote,
                    },
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows);
    }
}

export interface Bidwar_Entry {
    name: string;
    points: number;
    pointsNote?: string;
    nameNote?: string;
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
                        userEnteredValue: { numberValue: n.points },
                        note: n.pointsNote,
                    },
                    {
                        userEnteredValue: { stringValue: n.name },
                        note: n.userId,
                    },
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows);
    }
}

export interface Bidwar_BankEntry {
    userId: string;
    name: string;
    points: number;
    pointsNote?: string;
}

export function parseBidwarEntry(row: sheets_v4.Schema$RowData): Bidwar_Entry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const entry: Bidwar_Entry = {
        points: getEntryValue_Number(row.values[0]),
        pointsNote: row.values[0].note ?? undefined,
        name: getEntryValue_String(row.values[1]),
        nameNote: row.values[1].note ?? undefined,
    };
    return entry;
}

export function parseBidwarBankEntry(row: sheets_v4.Schema$RowData): Bidwar_BankEntry {
    if (!row.values) {
        throw new Error("Expected bank entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    let userId: string;
    try { // Twitch ids are numbers, but are always conveyed as strings. This is a sanity check against Google Sheets' auto-assuming that fields containing numbers are typed as such
        userId = String(getEntryValue_Number(row.values[2]));
    } catch (err) {
        userId = getEntryValue_String(row.values[2]);
    }        

    const bankEntry: Bidwar_BankEntry = {
        points: getEntryValue_Number(row.values[0]),
        name: getEntryValue_String(row.values[1]),
        pointsNote: row.values[1].note ?? undefined,
        userId: userId,
    }
    return bankEntry;
}

export function parseBidwarPendingBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_PendingBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: Bidwar_Entry[] = [];
    for (let i = 1; i < rows.length; i++) {
        console.log(i);
        const entry = parseBidwarEntry(rows[i]);
        entries.push(entry);
    }
    
    const pendingBlock = new Bidwar_PendingBlock({
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

export async function getBidwarSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetName: string): Promise<Bidwar_Spreadsheet> {
    const spreadsheet = await sheetsApi.spreadsheets.get({
        includeGridData: true,
        ranges: [subSheetName],
        spreadsheetId: sheetId,
    });

    if (!spreadsheet.data || !spreadsheet.data.sheets) {
        throw new Error("Unable to retrieve bidwar spreadsheet: sheet is empty");
    }

    const blockArray = extractBlockArray(spreadsheet.data.sheets[0]);
    let bidwarPendingBlock: Bidwar_PendingBlock | undefined = undefined;
    let bidwarActiveBlock: Bidwar_ActiveBlock | undefined = undefined;
    let bidwarBankBlock: Bidwar_BankBlock | undefined = undefined;
    for (let i = 0; i < 3; i++) {
        if (i === Bidwar_Spreadsheet_BlockOrder.Pending) {
            bidwarPendingBlock = parseBidwarPendingBlock(blockArray[i]);
        } else if (i === Bidwar_Spreadsheet_BlockOrder.Active) {
            bidwarActiveBlock = parseBidwarActiveBlock(blockArray[i]);
        } else if (i === Bidwar_Spreadsheet_BlockOrder.Bank) {
            bidwarBankBlock = parseBidwarBankBlock(blockArray[i]);
        }
    }

    if (!bidwarPendingBlock || !bidwarActiveBlock || !bidwarBankBlock) {
        throw new Error("Unable to parse discrete blocks from bidwar spreadsheet");
    }

    const bidwarSpreadsheet = new Bidwar_Spreadsheet(bidwarActiveBlock, bidwarPendingBlock, bidwarBankBlock);
    return bidwarSpreadsheet;
}

// export async function pushBidwarSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, _subSheetName: string, bidwarSpreadsheet: Bidwar_Spreadsheet): Promise<void> {    
//     const pendingBlockValues = bidwarSpreadsheet.pendingBlock.toGridData();
//     const activeBlockValues = bidwarSpreadsheet.activeBlock.toGridData();
//     const bankBlockValues = bidwarSpreadsheet.bankBlock.toGridData();
    
//     const batchUpdateRequest: sheets_v4.Schema$BatchUpdateValuesRequest = {
//         valueInputOption: "RAW",
//         data: [
//             {
//                 range: `Sheet4`,
//                 values: pendingBlockValues,
//             },
//             {
//                 range: `Sheet4!A${pendingBlockValues.length + 2}`,
//                 values: activeBlockValues,
//             },
//             {
//                 range: `Sheet4!A${pendingBlockValues.length + 2 + activeBlockValues.length + 2}`,
//                 values: bankBlockValues,
//             },
//         ],
//     };
//     await sheetsApi.spreadsheets.values.batchUpdate({
//         spreadsheetId: sheetId,
//         requestBody: batchUpdateRequest,
//     });
// }