import { sheets_v4 } from "googleapis";
import { ChannelPointRequests } from "../../ChannelPointRequests";
import { Utils } from "../../Utils";
import { basicDateFormat, basicEntryFormat, borderLeft, getBorderRowBelow } from "./GameRequestSpreadsheetStyle";
import { SpreadsheetBase, SpreadsheetBlock, SpreadsheetRow, extractBlockArray, getDatetimeFormulaForSpreadsheet, getEntryValue_Date, getEntryValue_Number, getEntryValue_String, headersToRowData, parseHeaderFooterRow } from "./SpreadsheetBase";

export enum GameRequest_Spreadsheet_BlockOrder {
    Completed = 0,
    InProgress = 1,
    Funded = 2,
    Unfunded = 3,
}

export class GameRequest_Spreadsheet extends SpreadsheetBase {
    public readonly unfundedBlock: GameRequest_UnfundedBlock;
    public readonly fundedBlock: GameRequest_FundedBlock;
    public readonly inProgressBlock: GameRequest_InProgressBlock;
    public readonly completedBlock: GameRequest_CompletedBlock;

    public constructor(unfundedBlock: GameRequest_UnfundedBlock, fundedBlock: GameRequest_FundedBlock, inProgressBlock: GameRequest_InProgressBlock, completedBlock: GameRequest_CompletedBlock) {
        super();
        this.unfundedBlock = unfundedBlock;
        this.fundedBlock = fundedBlock;
        this.inProgressBlock = inProgressBlock;
        this.completedBlock = completedBlock;
    }

    public findEntry(gameName: string): GameRequestEntry | undefined {
        const completedEntry = this.completedBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (completedEntry) {
            return completedEntry;
        }

        const inProgressEntry = this.inProgressBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (inProgressEntry) {
            return inProgressEntry;
        }
        
        const fundedEntry = this.fundedBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (fundedEntry) {
            return fundedEntry;
        }

        const unfundedEntry = this.unfundedBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (unfundedEntry) {
            return unfundedEntry;
        }

        return undefined;
    }

    public addPointsToEntry(username: string, gameName: string, points: number, timestamp: Date): void {
        const fundedEntry = this.fundedBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (fundedEntry) {
            let contribution = fundedEntry.contributions.find(n => n.name === username);
            if (!contribution) {
                contribution = { name: username, points: 0 };
                fundedEntry.contributions.push(contribution);
            }
            contribution.points += points;
            return;
        }
        
        const unfundedEntryIndex = this.unfundedBlock.entries.findIndex(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (unfundedEntryIndex === -1) {
            throw new Error(`Unable to add points to entry "${gameName}"`);
        }

        const unfundedEntry = this.unfundedBlock.entries.at(unfundedEntryIndex)!;
        let contribution = unfundedEntry.contributions.find(n => n.name === username); // ?? { name: username, points: 0 };
        if (!contribution) {
            contribution = { name: username, points: 0 };
            unfundedEntry.contributions.push(contribution);
        }
        contribution.points += points;

        if (unfundedEntry.pointsContributed >= unfundedEntry.pointsRequiredToFund) {         
            const fundedEntry = new GameRequest_FundedEntry({ gameName: unfundedEntry.gameName, estimatedGameLengthHours: unfundedEntry.estimatedGameLengthHours, pointsRequiredToFund: unfundedEntry.pointsRequiredToFund, dateRequested: unfundedEntry.dateRequested, contributions: Array.from(unfundedEntry.contributions), originalRequestorId: unfundedEntry.originalRequestorId, originalRequestorName: unfundedEntry.originalRequestorName, dateFunded: timestamp });
            this.unfundedBlock.entries.splice(unfundedEntryIndex, 1);
            this.fundedBlock.entries.push(fundedEntry);
        }
    }

    public addEntry(gameName: string, gameLengthHours: number, pointsRequiredToFund: number | undefined, userId: string, username: string, points: number, timestamp: Date): void {
        const contributions = [ { name: username, points: 0 } ];
        const unfundedEntry = new GameRequest_UnfundedEntry({ gameName, estimatedGameLengthHours: gameLengthHours, pointsRequiredToFund: pointsRequiredToFund, contributions, originalRequestorId: userId, originalRequestorName: username, dateRequested: timestamp });
        this.unfundedBlock.entries.push(unfundedEntry);
        this.addPointsToEntry(username, gameName, points, timestamp);
    }

    public startEntry(gameName: string, timestamp: Date): void {
        const fundedEntryIndex = this.fundedBlock.entries.findIndex(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (fundedEntryIndex === -1) {
            throw new Error(`Unable to find funded entry "${gameName}"`);
        }

        const fundedEntry = this.fundedBlock.entries[fundedEntryIndex];
        const inProgressEntry = GameRequest_InProgressEntry.fromFundedEntry(fundedEntry, timestamp);
        this.fundedBlock.entries.splice(fundedEntryIndex, 1);
        this.inProgressBlock.entries.push(inProgressEntry);
    }

    public completeEntry(gameName: string, timestamp: Date, hoursPlayed: number): void {
        const inProgressEntryIndex = this.inProgressBlock.entries.findIndex(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (inProgressEntryIndex === -1) {
            throw new Error(`Unable to find in-progress entry "${gameName}"`);
        }

        const inProgressEntry = this.inProgressBlock.entries[inProgressEntryIndex];
        const completedEntry = GameRequest_CompletedEntry.fromInProgressEntry(inProgressEntry, timestamp, hoursPlayed);
        this.inProgressBlock.entries.splice(inProgressEntryIndex, 1);
        this.completedBlock.entries.push(completedEntry);
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        return this.completedBlock.toRowData().concat(this.inProgressBlock.toRowData().concat(this.fundedBlock.toRowData().concat(this.unfundedBlock.toRowData())));
    }

    public static async getGameRequestSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetId: number): Promise<GameRequest_Spreadsheet> {
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
            throw new Error("Unable to retrieve game request spreadsheet: sheet is empty");
        }
    
        const blockArray = extractBlockArray(apiSpreadsheet.data.sheets[0]);
        let unfundedBlock: GameRequest_UnfundedBlock | undefined = undefined;
        let fundedBlock: GameRequest_FundedBlock | undefined = undefined;
        let inProgressBlock: GameRequest_InProgressBlock | undefined = undefined;
        let completedBlock: GameRequest_CompletedBlock | undefined = undefined;
        for (let i = 0; i < 4; i++) {
            if (i === GameRequest_Spreadsheet_BlockOrder.Funded) {
                fundedBlock = parseGameRequestFundedBlock(blockArray[i]);
            } else if (i === GameRequest_Spreadsheet_BlockOrder.Unfunded) {
                unfundedBlock = parseGameRequestUnfundedBlock(blockArray[i]);
            } else if (i === GameRequest_Spreadsheet_BlockOrder.InProgress) {
                inProgressBlock = parseGameRequestInProgressBlock(blockArray[i]);
            } else if (i === GameRequest_Spreadsheet_BlockOrder.Completed) {
                completedBlock = parseGameRequestCompletedBlock(blockArray[i]);
            }
        }
    
        if (!fundedBlock || !unfundedBlock || !inProgressBlock || !completedBlock) {
            throw new Error("Unable to parse discrete blocks from game request spreadsheet");
        }
    
        const gameRequestSpreadsheet = new GameRequest_Spreadsheet(unfundedBlock, fundedBlock, inProgressBlock, completedBlock);
        return gameRequestSpreadsheet;
    }
}

export abstract class GameRequestEntry {
    public constructor(
        public readonly gameName: string,
        public readonly estimatedGameLengthHours: number,
        /** overrides the calculated activation requirement if supplied */
        protected readonly _pointsRequiredToFundOverride: number | undefined,
        public readonly contributions: { name: string, points: number }[],
        public readonly dateRequested: Date,
        public readonly originalRequestorId: string,
        public readonly originalRequestorName: string) {
    }

    public get pointsContributed(): number {
        return this.contributions.reduce<number>((prev, current, _index) => {
            return prev + current.points;
        }, 0);
    }

    public get pointsRequiredToFund(): number {
        return this._pointsRequiredToFundOverride ?? ChannelPointRequests.getGameRequestPrice(this.estimatedGameLengthHours);
    }

    public abstract get effectivePoints(): number;
    public abstract get percentageFunded(): number;

    public get isFunded(): boolean { return false; }
    public get isStarted(): boolean { return false; }
    public get isCompleted(): boolean { return false; }
}

export class GameRequest_UnfundedEntry extends GameRequestEntry {
    public constructor(
        args: {
            gameName: string,
            estimatedGameLengthHours: number,
            /** overrides the calculated activation requirement if supplied */
            pointsRequiredToFund: number | undefined,
            contributions: { name: string, points: number }[],
            dateRequested: Date,
            originalRequestorId: string,
            originalRequestorName: string,
        }) {
        super(args.gameName, args.estimatedGameLengthHours, args.pointsRequiredToFund, args.contributions, args.dateRequested, args.originalRequestorId, args.originalRequestorName);
    }

    public override get percentageFunded(): number {
        return this.effectivePoints / this.pointsRequiredToFund;
    }

    public override get effectivePoints(): number {
        return this.pointsContributed;
    }
}

export class GameRequest_FundedEntry extends GameRequest_UnfundedEntry {    
    public readonly dateFunded: Date;

    public constructor(args: {
        gameName: string,
        estimatedGameLengthHours: number,
        dateRequested: Date,
        /** overrides the calculated activation requirement if supplied */
        pointsRequiredToFund: number | undefined,
        contributions: { name: string, points: number }[],
        originalRequestorId: string,
        originalRequestorName: string,
        dateFunded: Date,
    }) {
        super({ gameName: args.gameName, estimatedGameLengthHours: args.estimatedGameLengthHours, pointsRequiredToFund: args.pointsRequiredToFund, contributions: args.contributions, dateRequested: args.dateRequested, originalRequestorId: args.originalRequestorId, originalRequestorName: args.originalRequestorName });
        this.dateFunded = args.dateFunded;
    }

    public static fromUnfundedEntry(unfundedEntry: GameRequest_UnfundedEntry, dateFunded: Date): GameRequest_FundedEntry {
        return new GameRequest_FundedEntry({ gameName: unfundedEntry.gameName, estimatedGameLengthHours: unfundedEntry.estimatedGameLengthHours, pointsRequiredToFund: unfundedEntry.pointsRequiredToFund, contributions: unfundedEntry.contributions, dateRequested: unfundedEntry.dateRequested, originalRequestorId: unfundedEntry.originalRequestorId, originalRequestorName: unfundedEntry.originalRequestorName, dateFunded: dateFunded });
    }

    public override get isFunded(): boolean { return true; }

    public override get effectivePoints(): number {
        const elapsedMilliseconds = Date.now() - this.dateFunded.getTime();
        const elapsedYears = elapsedMilliseconds / (1000 * 60 * 60 * 24 * 365);
        return this.pointsContributed * Math.pow(2, elapsedYears);
    }
}

export class GameRequest_InProgressEntry extends GameRequest_FundedEntry {
    public readonly dateStarted: Date;
    
    public constructor(args: {
        gameName: string,
        estimatedGameLengthHours: number,
        dateRequested: Date,
        /** overrides the calculated activation requirement if supplied */
        pointsRequiredToFund: number | undefined,
        contributions: { name: string, points: number }[],
        originalRequestorId: string,
        originalRequestorName: string,
        dateFunded: Date,
        dateStarted: Date,
    }) {
        super({ gameName: args.gameName, estimatedGameLengthHours: args.estimatedGameLengthHours, pointsRequiredToFund: args.pointsRequiredToFund, contributions: args.contributions, dateRequested: args.dateRequested, originalRequestorId: args.originalRequestorId, originalRequestorName: args.originalRequestorName, dateFunded: args.dateFunded });
        this.dateStarted = args.dateStarted;
    }

    public static fromFundedEntry(fundedEntry: GameRequest_FundedEntry, dateStarted: Date): GameRequest_InProgressEntry {
        return new GameRequest_InProgressEntry({ gameName: fundedEntry.gameName, estimatedGameLengthHours: fundedEntry.estimatedGameLengthHours, pointsRequiredToFund: fundedEntry.pointsRequiredToFund, contributions: fundedEntry.contributions, dateRequested: fundedEntry.dateRequested, originalRequestorId: fundedEntry.originalRequestorId, originalRequestorName: fundedEntry.originalRequestorName, dateFunded: fundedEntry.dateFunded, dateStarted: dateStarted });
    }

    public override get isStarted(): boolean { return true; }

    public override get effectivePoints(): number {
        const elapsedMilliseconds = this.dateStarted.getTime() - this.dateFunded.getTime();
        const elapsedYears = elapsedMilliseconds / (1000 * 60 * 60 * 24 * 365);
        return this.pointsContributed * Math.pow(2, elapsedYears);
    }
}

export class GameRequest_CompletedEntry extends GameRequest_InProgressEntry {
    public readonly dateCompleted: Date;
    public readonly hoursPlayed: number;
    
    public constructor(args: {
        gameName: string,
        estimatedGameLengthHours: number,
        dateRequested: Date,
        /** overrides the calculated activation requirement if supplied */
        pointsRequiredToFund: number | undefined,
        contributions: { name: string, points: number }[],
        originalRequestorId: string,
        originalRequestorName: string,
        dateFunded: Date,
        dateStarted: Date,
        dateCompleted: Date,
        hoursPlayed: number,
    }) {
        super({ gameName: args.gameName, estimatedGameLengthHours: args.estimatedGameLengthHours, pointsRequiredToFund: args.pointsRequiredToFund, contributions: args.contributions, dateRequested: args.dateRequested, originalRequestorId: args.originalRequestorId, originalRequestorName: args.originalRequestorName, dateFunded: args.dateFunded, dateStarted: args.dateStarted });
        this.dateCompleted = args.dateCompleted;
        this.hoursPlayed = args.hoursPlayed;
    }

    public static fromInProgressEntry(inProgressEntry: GameRequest_InProgressEntry, dateCompleted: Date, hoursPlayed: number): GameRequest_CompletedEntry {
        return new GameRequest_CompletedEntry({ gameName: inProgressEntry.gameName, estimatedGameLengthHours: inProgressEntry.estimatedGameLengthHours, pointsRequiredToFund: inProgressEntry.pointsRequiredToFund, contributions: inProgressEntry.contributions, dateRequested: inProgressEntry.dateRequested, originalRequestorId: inProgressEntry.originalRequestorId, originalRequestorName: inProgressEntry.originalRequestorName, dateFunded: inProgressEntry.dateFunded, dateStarted: inProgressEntry.dateStarted, dateCompleted: dateCompleted, hoursPlayed: hoursPlayed, });
    }

    public override get isCompleted(): boolean { return true; }
}

export class GameRequest_UnfundedBlock extends SpreadsheetBlock {
    public headers: SpreadsheetRow[];
    public entries: GameRequest_UnfundedEntry[];

    public constructor(args: {
        headers: SpreadsheetRow[],
        entries: GameRequest_UnfundedEntry[],
    }) {
        super();
        this.headers = args.headers;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRows = headersToRowData(this.headers);
        const entryRows = this.entries.sort((a, b) => {
            const percentageComparison = b.percentageFunded - a.percentageFunded;
            if (percentageComparison === 0) {
                return a.estimatedGameLengthHours - b.estimatedGameLengthHours; // sort ascending
            } else {
                return percentageComparison;
            }
        }).map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.estimatedGameLengthHours },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} • ${c.points}`).join("\n"),
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsRequiredToFund, },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.percentageFunded, },
                        userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
                    },
                    {
                        userEnteredValue: { stringValue: n.originalRequestorName, },
                        note: n.originalRequestorId,
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateRequested)}` },
                        note: n.dateRequested.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    },
                ],
            };
            return rowData;
        });
        return headerRows.concat(entryRows).concat([getBorderRowBelow(7)]);
    }
}

export class GameRequest_FundedBlock extends SpreadsheetBlock {
    public headers: SpreadsheetRow[];
    public entries: GameRequest_FundedEntry[];

    public constructor(args: {
            headers: SpreadsheetRow[],
            entries: GameRequest_FundedEntry[],
        }) {
        super();
        this.headers = args.headers;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRows = headersToRowData(this.headers);
        // const dateFormat: sheets_v4.Schema$CellFormat = { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd " } };
        const entryRows = this.entries.sort((a, b) => {
            const percentageComparison = b.percentageFunded - a.percentageFunded;
            if (percentageComparison === 0) {
                return a.estimatedGameLengthHours - b.estimatedGameLengthHours; // sort ascending
            } else {
                return percentageComparison;
            }
        }).map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.estimatedGameLengthHours },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} • ${c.points}`).join("\n"),
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsRequiredToFund },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        // userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.requestDate)}` },
                        userEnteredValue: { formulaValue: `=${getElapsedTimeFormulaForSpreadsheet(5, false)}` },
                        //userEnteredFormat: Object.assign({}, unfundedEntryFormat, dateFormat),
                        userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ horizontalAlignment: "RIGHT" }),
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getEffectivePointsFormulaForSpreadsheet(-3, 4)}` },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getPercentageFundedFormulaForSpreadsheet_NotStarted(-3, -1)}` },
                        userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
                    },
                    {
                        userEnteredValue: { stringValue: n.originalRequestorName, },
                        note: n.originalRequestorId,
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateRequested)}` },
                        note: n.dateRequested.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateFunded)}` },
                        note: n.dateFunded.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    }
                ],
            };
            return rowData;
        });
        return headerRows.concat(entryRows).concat(getBorderRowBelow(10));
    }
}

export class GameRequest_InProgressBlock extends SpreadsheetBlock {
    public headers: SpreadsheetRow[];
    public entries: GameRequest_InProgressEntry[];

    public constructor(args: {
        headers: SpreadsheetRow[],
        entries: GameRequest_InProgressEntry[],
    }) {
        super();
        this.headers = args.headers;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRows = headersToRowData(this.headers);
        // const dateFormat: sheets_v4.Schema$CellFormat = { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd " } };
        const entryRows = this.entries.sort((a, b) => {
            const dateStartedComparison = b.dateStarted.getTime() - a.dateStarted.getTime();
            return dateStartedComparison;
        }).map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.estimatedGameLengthHours },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} • ${c.points}`).join("\n"),
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateStarted)}` },
                        note: n.dateStarted.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateFunded)}` },
                        note: n.dateFunded.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getPercentageFundedFormulaForSpreadsheet_Started(-4, -1, -2, n.pointsRequiredToFund)}` },
                        note: `${n.pointsRequiredToFund}`,
                        userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
                    },
                    {
                        userEnteredValue: { stringValue: n.originalRequestorName, },
                        note: n.originalRequestorId,
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateRequested)}` },
                        note: n.dateRequested.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    }
                ],
            };
            return rowData;
        });
        return headerRows.concat(entryRows).concat(getBorderRowBelow(9));
    }
}

export class GameRequest_CompletedBlock extends SpreadsheetBlock {
    public headers: SpreadsheetRow[];
    public entries: GameRequest_CompletedEntry[];

    public constructor(args: {
        headers: SpreadsheetRow[],
        entries: GameRequest_CompletedEntry[],
    }) {
        super();
        this.headers = args.headers;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRows = headersToRowData(this.headers);
        // const dateFormat: sheets_v4.Schema$CellFormat = { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd " } };
        const entryRows = this.entries.sort((a, b) => {
            const dateStartedComparison = b.dateCompleted.getTime() - a.dateCompleted.getTime();
            return dateStartedComparison;
        }).map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.hoursPlayed },
                        note: `${n.estimatedGameLengthHours}`,
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} • ${c.points}`).join("\n"),
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateCompleted)}` },
                        note: n.dateCompleted.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateStarted)}` },
                        note: n.dateStarted.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateFunded)}` },
                        note: n.dateFunded.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getPercentageFundedFormulaForSpreadsheet_Started(-4, -1, -2, n.pointsRequiredToFund)}` },
                        note: `${n.pointsRequiredToFund}`,
                        userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
                    },
                    {
                        userEnteredValue: { stringValue: n.originalRequestorName, },
                        note: n.originalRequestorId,
                        userEnteredFormat: basicEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.dateRequested)}` },
                        note: n.dateRequested.toISOString(),
                        userEnteredFormat: basicDateFormat,
                    },
                    {
                        userEnteredFormat: borderLeft,
                    }
                ],
            };
            return rowData;
        });
        return headerRows.concat(entryRows).concat(getBorderRowBelow(9));
    }
}

export function parseGameRequestUnfundedEntry(row: sheets_v4.Schema$RowData): GameRequest_UnfundedEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const gameName = getEntryValue_String(row.values[0]);
    const gameLengthHours = getEntryValue_Number(row.values[1]);
    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    const pointsRequiredToFund = row.values[3]
        ? getEntryValue_Number(row.values[3])
        : undefined;
    const originalRequestorName = getEntryValue_String(row.values[5]) ?? "";
    const originalRequestorId = row.values[5].note ?? "";
    const dateRequested = row.values[6].note
        ? Utils.getDateFromUtcTimestring(row.values[6].note)
        : getEntryValue_Date(row.values[6]);

    if (!gameName || !gameLengthHours || !dateRequested) {
        throw new Error("Required properties not found when parsing unfunded game request entry: gameName, gameLengthHours");
    }
    
    const entry = new GameRequest_UnfundedEntry({
        gameName,
        estimatedGameLengthHours: gameLengthHours,
        contributions,
        pointsRequiredToFund: pointsRequiredToFund,
        dateRequested,
        originalRequestorId,
        originalRequestorName,
    });

    return entry;
}

export function parseGameRequestFundedEntry(row: sheets_v4.Schema$RowData): GameRequest_FundedEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const gameName = getEntryValue_String(row.values[0]);
    const gameLengthHours = getEntryValue_Number(row.values[1]);
    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    const pointsRequiredToFund = row.values[3]
        ? getEntryValue_Number(row.values[3])
        : undefined;
    const originalRequestorName = getEntryValue_String(row.values[7]) ?? "";
    const originalRequestorId = row.values[7].note ?? "";
    const dateRequested = row.values[8].note
        ? Utils.getDateFromUtcTimestring(row.values[8].note)
        : getEntryValue_Date(row.values[8]);
    const dateFunded = row.values[9].note
        ? Utils.getDateFromUtcTimestring(row.values[9].note)
        : getEntryValue_Date(row.values[9]);

    if (!gameName || !gameLengthHours || !dateRequested || !dateFunded) {
        throw new Error("Required properties not found when parsing funded game request entry: gameName, gameLengthHours, requestDate");
    }

    const entry = new GameRequest_FundedEntry({
        gameName,
        estimatedGameLengthHours: gameLengthHours,
        pointsRequiredToFund: pointsRequiredToFund,
        contributions,
        dateRequested,
        originalRequestorId,
        originalRequestorName,
        dateFunded,
    });
    return entry;
}

export function parseGameRequestInProgressEntry(row: sheets_v4.Schema$RowData): GameRequest_InProgressEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const gameName = getEntryValue_String(row.values[0]);
    const gameLengthHours = getEntryValue_Number(row.values[1]);
    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    const dateStarted = row.values[4].note
        ? Utils.getDateFromUtcTimestring(row.values[4].note)
        : getEntryValue_Date(row.values[4]);
    const dateFunded = row.values[5].note
        ? Utils.getDateFromUtcTimestring(row.values[5].note)
        : getEntryValue_Date(row.values[5]);
    const pointsRequiredToFund = row.values[6].note
        ? Number.parseInt(row.values[6].note)
        : getEntryValue_Number(row.values[6]);
    const originalRequestorName = getEntryValue_String(row.values[7]) ?? "";
    const originalRequestorId = row.values[7].note ?? "";
    const dateRequested = row.values[8].note
        ? Utils.getDateFromUtcTimestring(row.values[8].note)
        : getEntryValue_Date(row.values[8]);    

    if (!gameName || !gameLengthHours || !dateRequested || !dateFunded || !dateStarted) {
        throw new Error("Required properties not found when parsing in progress game request entry: gameName, gameLengthHours, requestDate");
    }

    const entry = new GameRequest_InProgressEntry({
        gameName,
        estimatedGameLengthHours: gameLengthHours,
        pointsRequiredToFund: pointsRequiredToFund,
        contributions,
        dateRequested,
        originalRequestorId,
        originalRequestorName,
        dateFunded,
        dateStarted,
    });
    return entry;
}

export function parseGameRequestCompletedEntry(row: sheets_v4.Schema$RowData): GameRequest_CompletedEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const gameName = getEntryValue_String(row.values[0]);
    const hoursPlayed = getEntryValue_Number(row.values[1]);
    const estimatedGameLengthHours = row.values[1].note
        ? Number.parseFloat(row.values[1].note)
        : undefined;
    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    const dateCompleted = row.values[3].note
        ? Utils.getDateFromUtcTimestring(row.values[3].note)
        : getEntryValue_Date(row.values[3]);
    const dateStarted = row.values[4].note
        ? Utils.getDateFromUtcTimestring(row.values[4].note)
        : getEntryValue_Date(row.values[4]);
    const dateFunded = row.values[5].note
        ? Utils.getDateFromUtcTimestring(row.values[5].note)
        : getEntryValue_Date(row.values[5]);
    const pointsRequiredToFund = row.values[6].note
        ? Number.parseInt(row.values[6].note)
        : getEntryValue_Number(row.values[6]);
    const originalRequestorName = getEntryValue_String(row.values[7]) ?? "";
    const originalRequestorId = row.values[7].note ?? "";
    const dateRequested = row.values[8].note
        ? Utils.getDateFromUtcTimestring(row.values[8].note)
        : getEntryValue_Date(row.values[8]);    

    if (!gameName || !estimatedGameLengthHours || !dateRequested || !dateFunded || !dateStarted || !dateCompleted || !hoursPlayed) {
        throw new Error("Required properties not found when parsing completed game request entry: gameName, gameLengthHours, requestDate");
    }

    const entry = new GameRequest_CompletedEntry({
        gameName,
        estimatedGameLengthHours,
        pointsRequiredToFund,
        contributions,
        dateRequested,
        originalRequestorId,
        originalRequestorName,
        dateFunded,
        dateStarted,
        dateCompleted,
        hoursPlayed,
    });
    return entry;
}

export function parseGameRequestUnfundedBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_UnfundedBlock {
    const headerRows = [
        parseHeaderFooterRow(rows[0]),
        parseHeaderFooterRow(rows[1]),
    ];

    const entries: GameRequest_UnfundedEntry[] = [];
    for (let i = 2; i < rows.length; i++) {
        const entry = parseGameRequestUnfundedEntry(rows[i]);
        entries.push(entry);
    }
    
    const block = new GameRequest_UnfundedBlock({
        headers: headerRows,
        entries: entries,
    });
    return block;
}

export function parseGameRequestFundedBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_FundedBlock {
    const headerRows = [
        parseHeaderFooterRow(rows[0]),
        parseHeaderFooterRow(rows[1]),
    ];

    const entries: GameRequest_FundedEntry[] = [];
    for (let i = 2; i < rows.length; i++) {
        const entry = parseGameRequestFundedEntry(rows[i]);
        entries.push(entry);
    }
    
    const block = new GameRequest_FundedBlock({
        headers: headerRows,
        entries: entries,
    });
    return block;
}

export function parseGameRequestInProgressBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_InProgressBlock {
    const headerRows = [
        parseHeaderFooterRow(rows[0]),
        parseHeaderFooterRow(rows[1]),
    ];

    const entries: GameRequest_InProgressEntry[] = [];
    for (let i = 2; i < rows.length; i++) {
        const entry = parseGameRequestInProgressEntry(rows[i]);
        entries.push(entry);
    }
    
    const block = new GameRequest_InProgressBlock({
        headers: headerRows,
        entries: entries,
    });
    return block;
}

export function parseGameRequestCompletedBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_CompletedBlock {
    const headerRows = [
        parseHeaderFooterRow(rows[0]),
        parseHeaderFooterRow(rows[1]),
    ];

    const entries: GameRequest_CompletedEntry[] = [];
    for (let i = 2; i < rows.length; i++) {
        const entry = parseGameRequestCompletedEntry(rows[i]);
        entries.push(entry);
    }
    
    const block = new GameRequest_CompletedBlock({
        headers: headerRows,
        entries: entries,
    });
    return block;
}

export function parseContributions(contributionsString: string): { name: string, points: number }[] {
    if (!contributionsString) {
        return [];
    }

    const contributions = contributionsString.split("\n").map(n => { 
        const tokens = n.split(/\s*•\s*/);
        const name = tokens[0];
        const points = Number.parseInt(tokens[1]);
        return { name: name, points: points };
    });
    return contributions;
}

/** https://infoinspired.com/google-docs/spreadsheet/elapsed-days-and-time-between-two-dates-in-sheets/ */
export function getElapsedTimeFormulaForSpreadsheet(dateFundedCellOffset: number, includeTime: boolean = true): string {
    const dateDifferenceFormula = `NOW()-INDIRECT(ADDRESS(ROW(), COLUMN()+${dateFundedCellOffset}))`;
    const elapsedDaysFormula = `int(${dateDifferenceFormula})`;
    const elapsedHoursFormula = `text(${dateDifferenceFormula}-${elapsedDaysFormula},"HH")`;
    const formulaStr = includeTime
        ? `${elapsedDaysFormula}&" days "&${elapsedHoursFormula}&" hours"`
        : `${elapsedDaysFormula}&" days"`;
    return formulaStr;
}

export function getEffectivePointsFormulaForSpreadsheet(pointsContributedCellOffset: number, dateFundedCellOffset: number, dateStartedCellOffset?: number): string {
    const dateFundedReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${dateFundedCellOffset}))`;
    const dateStartedReferenceFormula = dateStartedCellOffset
        ? `INDIRECT(ADDRESS(ROW(), COLUMN()+${dateStartedCellOffset}))`
        : `NOW()`;
    const dateDifferenceFormula = `${dateStartedReferenceFormula}-(${dateFundedReferenceFormula})`;
    const elapsedYearsFormula = `int(${dateDifferenceFormula}) / 365`;
    const pointsContributedFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${pointsContributedCellOffset}))`;
    const effectivePointsFormula = `${pointsContributedFormula} * POW(2, ${elapsedYearsFormula})`;
    return effectivePointsFormula;
}

export function getPercentageFundedFormulaForSpreadsheet_NotStarted(pointsRequiredToFundCellOffset: number, effectivePointsCellOffset: number): string {
    const effectivePointsReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${effectivePointsCellOffset}))`;
    const pointsRequiredToFundReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${pointsRequiredToFundCellOffset}))`
    return `${effectivePointsReferenceFormula} / ${pointsRequiredToFundReferenceFormula}`;
}

export function getPercentageFundedFormulaForSpreadsheet_Started(pointsContributedCellOffset: number, dateFundedCellOffset: number, dateStartedCellOffset: number, pointsRequiredToFund: number,): string {
    const effectivePointsFormula = getEffectivePointsFormulaForSpreadsheet(pointsContributedCellOffset, dateFundedCellOffset, dateStartedCellOffset);
    return `${effectivePointsFormula} / ${pointsRequiredToFund}`;
}