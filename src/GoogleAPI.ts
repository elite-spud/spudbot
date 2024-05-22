import { JWT } from "google-auth-library";
import { google, sheets_v4 } from "googleapis";
import { Future } from "./Future";
import { Bidwar_BankEntry, Bidwar_BankEntryBlock, Bidwar_Entry, Bidwar_EntryBlock, Bidwar_Spreadsheet, Bidwar_Spreadsheet_BlockOrder } from "./SpudBotTypes";
import { TaskQueue } from "./TaskQueue";

export interface GoogleAPIConfig {
    oauth: {
        clientId: string;
        clientSecret: string;
        scope: string;
    };
    jwt: {
        type: string,
        project_id: string,
        private_key_id: string,
        private_key: string,
        client_email: string,
        client_id: string,
        auth_uri: string,
        token_uri: string,
        auth_provider_x509_cert_url: string,
        client_x509_cert_url: string,
        universe_domain: string,
    };
}

export class GoogleAPI {
    public static readonly incentiveSheetId = "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY";
    public static readonly bidwarTestSubSheet = "Sheet3"; 

    protected readonly _config: GoogleAPIConfig
    public readonly _googleSheets = new Future<sheets_v4.Sheets>();

    protected _taskQueue: TaskQueue = new TaskQueue();

    public constructor(config: GoogleAPIConfig) { // TODO: make a singleton?
        this._config = config;
    }

    public async startup(): Promise<void> {
        const client = new JWT({
            email: this._config.jwt.client_email,
            key: this._config.jwt.private_key,
            scopes: ["https://www.googleapis.com/auth/drive"],
        });

        const sheets = google.sheets({
            version: 'v4',
            auth: await client,
        });

        this._googleSheets.resolve(sheets);
    }

    public async pushBidwarSpreadsheet(sheetId: string, subSheetName: string, bidwarSpreadsheet: Bidwar_Spreadsheet): Promise<void> {
        const future = new Future<void>();
        
        const task = async (): Promise<void> => {
            await this._pushBidwarSpreadsheet(sheetId, subSheetName, bidwarSpreadsheet);
            future.resolve();
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    protected async _pushBidwarSpreadsheet(sheetId: string, _subSheetName: string, bidwarSpreadsheet: Bidwar_Spreadsheet): Promise<void> {
        const sheets = await this._googleSheets;

        const pendingBlockHeaderValues: (string | number | undefined)[][] = [bidwarSpreadsheet.pendingBlock.header];
        const pendingBlockEntryValues = bidwarSpreadsheet.pendingBlock.entries.map(n => [n.points, n.name]);
        const pendingBlockFooterValues: (string | number | undefined)[][] = [bidwarSpreadsheet.pendingBlock.footer];
        const pendingBlockValues = pendingBlockHeaderValues.concat(pendingBlockEntryValues).concat(pendingBlockFooterValues);

        const activeBlockHeaderValues: (string | number | undefined)[][] = [bidwarSpreadsheet.activeBlock.header];
        const activeBlockEntryValues = bidwarSpreadsheet.activeBlock.entries.map(n => [n.points, n.name]);
        const activeBlockFooterValues: (string | number | undefined)[][] = [bidwarSpreadsheet.activeBlock.footer];
        const activeBlockValues = activeBlockHeaderValues.concat(activeBlockEntryValues).concat(activeBlockFooterValues);

        const bankBlockHeaderValues: (string | number | undefined)[][] = [bidwarSpreadsheet.bankBlock.header];
        const bankBlockEntryValues = bidwarSpreadsheet.bankBlock.entries.map(n => [n.points, n.name, n.userId]);
        const bankBlockFooterValues: (string | number | undefined)[][] = [bidwarSpreadsheet.bankBlock.footer];
        const bankBlockValues = bankBlockHeaderValues.concat(bankBlockEntryValues).concat(bankBlockFooterValues);

        console.log(JSON.stringify(bidwarSpreadsheet.bankBlock));
        console.log(bankBlockValues);
        
        const batchUpdateRequest: sheets_v4.Schema$BatchUpdateValuesRequest = {
            valueInputOption: "RAW",
            data: [
                {
                    range: `Sheet4`,
                    values: pendingBlockValues,
                },
                {
                    range: `Sheet4!A${pendingBlockValues.length + 1}`,
                    values: activeBlockValues,
                },
                {
                    range: `Sheet4!A${pendingBlockValues.length + 1 + activeBlockValues.length + 1}`,
                    values: bankBlockValues
                }
            ]
        };
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: batchUpdateRequest,
        });
    }

    public async getBidwarSpreadsheet(sheetId: string, subSheetName: string): Promise<Bidwar_Spreadsheet> {
        const future = new Future<Bidwar_Spreadsheet>();
        
        const task = async (): Promise<void> => {
            const bidwarSpreadsheet = await this._getBidwarSpreadsheet(sheetId, subSheetName);
            future.resolve(bidwarSpreadsheet);
        }
        this._taskQueue.addTask(task);
        this._taskQueue.startQueue();

        return future;
    }

    protected async _getBidwarSpreadsheet(sheetId: string, subSheetName: string): Promise<Bidwar_Spreadsheet> {
        const googleSheets = await this._googleSheets;

        const spreadsheet = await googleSheets.spreadsheets.get({
            includeGridData: true,
            ranges: [subSheetName],
            spreadsheetId: sheetId,
        });

        const blockArray: sheets_v4.Schema$RowData[][] = [];
        for (const sheet of spreadsheet.data.sheets!) {
            for (const gridData of sheet.data!) {
                let gridHasData = false;
                let rowArray: sheets_v4.Schema$RowData[] = [];
                for (const row of gridData.rowData!) {
                    let rowHasData = false;
                    for (const value of row.values!) {
                        if (value.userEnteredValue) {
                            rowHasData = true;
                            gridHasData = true;
                            break;
                        }
                    }

                    if (rowHasData) {
                        rowArray.push(row);
                    } else {
                        blockArray.push(rowArray);
                        rowArray = [];
                    }
                }

                if (gridHasData) {
                    blockArray.push(rowArray);
                }
            }
        }

        let bidwarPendingBlock: Bidwar_EntryBlock | undefined = undefined;
        let bidwarActiveBlock: Bidwar_EntryBlock | undefined = undefined;
        let bidwarBankBlock: Bidwar_BankEntryBlock | undefined = undefined;
        for (let i = 0; i < 3; i++) {
            if (i === Bidwar_Spreadsheet_BlockOrder.Pending) {
                bidwarPendingBlock = this.parseBidwarPendingBlock(blockArray[i]);
            } else if (i === Bidwar_Spreadsheet_BlockOrder.Active) {
                bidwarActiveBlock = this.parseBidwarActiveBlock(blockArray[i]);
            } else if (i === Bidwar_Spreadsheet_BlockOrder.Bank) {
                bidwarBankBlock = this.parseBidwarBankBlock(blockArray[i]);
            }
        }

        if (!bidwarPendingBlock || !bidwarActiveBlock || !bidwarBankBlock) {
            throw new Error("Unable to parse discrete blocks from bidwar spreadsheet");
        }

        const bidwarSpreadsheet = new Bidwar_Spreadsheet(bidwarActiveBlock, bidwarPendingBlock, bidwarBankBlock);
        return bidwarSpreadsheet;
    }

    protected getEntryValue_String(cell: sheets_v4.Schema$CellData): string {
        if (cell.userEnteredValue === undefined) {
            throw new Error("Expected value to not be undefined");
        }
        if (cell.userEnteredValue.stringValue !== undefined && cell.userEnteredValue.stringValue !== null) {
            return cell.userEnteredValue.stringValue;
        }
        if (cell.userEnteredValue.formulaValue !== undefined && cell.userEnteredValue.formulaValue !== null) {
            return cell.userEnteredValue.formulaValue;
        }
        throw new Error(`Cell value was expected to be string, but had no string values`);
    }

    protected getEntryValue_Number(cell: sheets_v4.Schema$CellData): number {
        if (cell.userEnteredValue === undefined) {
            throw new Error("Expected value to not be undefined");
        }
        if (cell.userEnteredValue.numberValue !== undefined && cell.userEnteredValue.numberValue !== null) {
            return cell.userEnteredValue.numberValue;
        }
        throw new Error(`Cell value was expected to be a number, but had no number values`);
    }

    protected getEntryValue_Boolean(cell: sheets_v4.Schema$CellData): boolean {
        if (cell.userEnteredValue === undefined) {
            throw new Error("Expected value to not be undefined");
        }
        if (cell.userEnteredValue.boolValue !== undefined && cell.userEnteredValue.boolValue !== null) {
            return cell.userEnteredValue.boolValue;
        }
        throw new Error(`Cell value was expected to be a boolean, but had no boolean values`);
    }

    protected parseEntry(row: sheets_v4.Schema$RowData): Bidwar_Entry {
        if (!row.values) {
            throw new Error("Expected entry row to have values");
        }
        // TODO: enforce a length at least as long as is required

        const entry: Bidwar_Entry = {
            points: this.getEntryValue_Number(row.values[0]),
            pointsNote: row.values[0].note ?? undefined,
            name: this.getEntryValue_String(row.values[1]),
            nameNote: row.values[1].note ?? undefined,
        };
        return entry;
    }

    protected parseBankEntry(row: sheets_v4.Schema$RowData): Bidwar_BankEntry {
        if (!row.values) {
            throw new Error("Expected bank entry row to have values");
        }
        // TODO: enforce a length at least as long as is required

        let userId: string;
        try { // Twitch ids are numbers, but are always conveyed as strings. This is a sanity check against Google Sheets' auto-assuming that fields containing numbers are typed as such
            userId = String(this.getEntryValue_Number(row.values[2]));
        } catch (err) {
            userId = this.getEntryValue_String(row.values[2]);
        }        

        const bankEntry: Bidwar_BankEntry = {
            points: this.getEntryValue_Number(row.values[0]),
            name: this.getEntryValue_String(row.values[1]),
            pointsNote: row.values[1].note ?? undefined,
            userId: userId,
        }
        return bankEntry;
    }

    // TODO: return a generic header row type
    protected parseHeaderFooterBidwarRow(row: sheets_v4.Schema$RowData): (string | undefined)[] {
        if (!row.values) {
            throw new Error("Expected header/footer row to have values");
        }
        
        const array: (string | undefined)[] = [];
        for (const value of row.values) {
            try {
                const strValue = this.getEntryValue_String(value);
                array.push(strValue);
            } catch {
                array.push(undefined);
            }
        }
        return array;
    }

    protected parseBidwarPendingBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_EntryBlock {
        const headerRow = this.parseHeaderFooterBidwarRow(rows[0]);

        const entries: Bidwar_Entry[] = [];
        for (let i = 1; i < rows.length; i++) {
            console.log(i);
            const entry = this.parseEntry(rows[i]);
            entries.push(entry);
        }
        
        const pendingBlock: Bidwar_EntryBlock = {
            header: headerRow,
            entries: entries,
            footer: [],
        };
        return pendingBlock;
    }

    protected parseBidwarActiveBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_EntryBlock {
        const headerRow = this.parseHeaderFooterBidwarRow(rows[0]);

        const entries: Bidwar_Entry[] = [];
        for (let i = 1; i < rows.length - 1; i++) {
            const entry = this.parseEntry(rows[i]);
            entries.push(entry);
        }

        const footerRow = this.parseHeaderFooterBidwarRow(rows[rows.length - 1]);
        
        const activeBlock: Bidwar_EntryBlock = {
            header: headerRow,
            entries: entries,
            footer: footerRow,
        };
        return activeBlock;
    }

    protected parseBidwarBankBlock(rows: sheets_v4.Schema$RowData[]): Bidwar_BankEntryBlock {
        const headerRow = this.parseHeaderFooterBidwarRow(rows[0]);

        const entries: Bidwar_BankEntry[] = [];
        for (let i = 1; i < rows.length; i++) {
            const entry = this.parseBankEntry(rows[i]);
            entries.push(entry);
        }
        
        const bankBlock: Bidwar_BankEntryBlock = {
            header: headerRow,
            entries: entries,
            footer: [],
        };
        return bankBlock;
    }

    // public async testGoogleApi(): Promise<void> {
    //     const sheets = await this._googleSheets;

    //     const resource = await sheets.spreadsheets.values.get({
    //         spreadsheetId: "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY",
    //         range: "A1:B2",
    //     });
    //     const rows = resource.data.values;
    //     if (!rows) {
    //         console.log("no rows found");
    //         return;
    //     }
    //     for (const row of rows) {
    //         for (const cell of row) {
    //             console.log(cell);
    //         }
    //     }

    //     const batchUpdateRequest: sheets_v4.Schema$BatchUpdateValuesRequest = {
    //         valueInputOption: "RAW",
    //         data: [
    //             {
    //                 range: "Sheet3!A1",
    //                 values: [
    //                     ["A1"],
    //                 ]
    //             },
    //             {
    //                 range: "Sheet3!A4:C4",
    //                 values: [
    //                     ["foo", "bar"],
    //                 ]
    //             },
    //             {
    //                 range: "Sheet3!A6:A10",
    //                 values: [
    //                     ["foo"], ["bar"],
    //                 ]
    //             },
    //         ]
    //     };
    //     await sheets.spreadsheets.values.batchUpdate({
    //         spreadsheetId: GoogleAPI.incentiveSheetId,
    //         requestBody: batchUpdateRequest,
    //     });

    //     await this.getSpreadsheetInfo(GoogleAPI.incentiveSheetId, ["General Incentives!A1:Z50"]);
    // }

    // public async getSpreadsheetInfo(spreadsheetId: string, ranges: string[]): Promise<void> {
    //     const googleSheets = await this._googleSheets;

    //     const spreadsheet = await googleSheets.spreadsheets.get({
    //         includeGridData: true,
    //         ranges: ranges,
    //         spreadsheetId: spreadsheetId,
    //     });

    //     if (!spreadsheet.data.sheets) {
    //         return;
    //     }
    //     for (const sheet of spreadsheet.data.sheets) {
    //         if (!sheet.data) {
    //             continue;
    //         }
    //         for (const window of sheet.data) {
    //             if (!window.rowData) {
    //                 continue;
    //             }
    //             for (const row of window.rowData) {
    //                 if (!row.values) {
    //                     continue;
    //                 }
    //                 let rowStr = "";
    //                 for (const value of row.values) {
    //                     rowStr += value.formattedValue + ",";
    //                 }
    //                 console.log(rowStr);
    //             }
    //         }
    //     }
    // }

    protected subIncentiveToChatMessage(currentSubPoints: number, requiredSubPoints: number, activity: string): void {
        `We are currently at ${currentSubPoints}/${requiredSubPoints} towards the current subgoal incentive. If that goal is met, I'll ${activity}`;
    }
}