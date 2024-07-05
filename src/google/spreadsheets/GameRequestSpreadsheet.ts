import { sheets_v4 } from "googleapis";
import { ChannelPointRequests } from "../../ChannelPointRequests";
import { borderLeft, getBorderRowBelow, pendingEntryFormat } from "./GameRequestSpreadsheetStyle";
import { SpreadsheetBase, SpreadsheetBlock, SpreadsheetRow, extractBlockArray, getDatetimeFormulaForSpreadsheet, getElapsedTimeFormulaForSpreadsheet, getEntryValue_Date, getEntryValue_Number, getEntryValue_String, headersToRowData, parseHeaderFooterRow } from "./SpreadsheetBase";

export enum GameRequest_Spreadsheet_BlockOrder {
    Active = 0,
    Pending = 1,
}

export class GameRequest_Spreadsheet extends SpreadsheetBase {
    public readonly activeBlock: GameRequest_ActiveBlock;
    public readonly pendingBlock: GameRequest_PendingBlock;

    public constructor(activeBlock: GameRequest_ActiveBlock, pendingBlock: GameRequest_PendingBlock) {
        super();
        this.activeBlock = activeBlock;
        this.pendingBlock = pendingBlock;
    }

    public findEntry(gameName: string): GameRequestEntry | undefined {
        const activeEntry = this.activeBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (activeEntry) {
            return activeEntry;
        }

        const pendingEntry = this.pendingBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (pendingEntry) {
            return pendingEntry;
        }

        return undefined;
    }

    public addPointsToEntry(username: string, gameName: string, points: number, timestamp: Date): void {
        const activeEntry = this.activeBlock.entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (activeEntry) {
            let contribution = activeEntry.contributions.find(n => n.name === username);
            if (!contribution) {
                contribution = { name: username, points: 0 };
                activeEntry.contributions.push(contribution);
            }
            contribution.points += points;
            return;
        }
        
        const pendingEntryIndex = this.pendingBlock.entries.findIndex(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (pendingEntryIndex !== -1) {
            const pendingEntry = this.pendingBlock.entries.at(pendingEntryIndex)!;
            let contribution = pendingEntry.contributions.find(n => n.name === username); // ?? { name: username, points: 0 };
            if (!contribution) {
                contribution = { name: username, points: 0 };
                pendingEntry.contributions.push(contribution);
            }
            contribution.points += points;

            if (pendingEntry.pointsContributed >= pendingEntry.pointsToActivate) {         
                const activeEntry = new GameRequest_ActiveEntry({ gameName: pendingEntry.gameName, gameLengthHours: pendingEntry.gameLengthHours, pointsToActivate: pendingEntry.pointsToActivate, requestDate: timestamp, contributions: Array.from(pendingEntry.contributions) });
                this.pendingBlock.entries.splice(pendingEntryIndex, 1);
                this.activeBlock.entries.push(activeEntry);
            }
            return;
        }

        throw new Error();
    }

    public addEntry(gameName: string, gameLengthHours: number, pointsToActivate: number | undefined, username: string, points: number, timestamp: Date): void {
        const contributions = [ { name: username, points: 0 } ];
        const pendingEntry = new GameRequest_PendingEntry({ gameName, gameLengthHours, pointsToActivate, contributions });
        this.pendingBlock.entries.push(pendingEntry);
        this.addPointsToEntry(username, gameName, points, timestamp);
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        return this.activeBlock.toRowData().concat(this.pendingBlock.toRowData());
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
        let activeBlock: GameRequest_ActiveBlock | undefined = undefined;
        let pendingBlock: GameRequest_PendingBlock | undefined = undefined;
        for (let i = 0; i < 2; i++) {
            if (i === GameRequest_Spreadsheet_BlockOrder.Active) {
                activeBlock = parseGameRequestActiveBlock(blockArray[i]);
            } else if (i === GameRequest_Spreadsheet_BlockOrder.Pending) {
                pendingBlock = parseGameRequestPendingBlock(blockArray[i]);
            }
        }
    
        if (!activeBlock || !pendingBlock) {
            throw new Error("Unable to parse discrete blocks from game request spreadsheet");
        }
    
        const gameRequestSpreadsheet = new GameRequest_Spreadsheet(activeBlock, pendingBlock);
        return gameRequestSpreadsheet;
    }
}

export class GameRequest_ActiveBlock extends SpreadsheetBlock {
    public headers: SpreadsheetRow[];
    public entries: GameRequest_ActiveEntry[];

    public constructor(args: {
            headers: SpreadsheetRow[],
            entries: GameRequest_ActiveEntry[],
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
                return a.gameLengthHours - b.gameLengthHours; // sort ascending
            } else {
                return percentageComparison;
            }
        }).map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.gameLengthHours },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} • ${c.points}`).join("\n"),
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsToActivate },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        // userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(n.requestDate)}` },
                        userEnteredValue: { formulaValue: `=${getElapsedTimeFormulaForSpreadsheet(n.requestDate, false)}` },
                        note: n.requestDate.toISOString(),
                        //userEnteredFormat: Object.assign({}, pendingEntryFormat, dateFormat),
                        userEnteredFormat: Object.assign({}, pendingEntryFormat, <sheets_v4.Schema$CellFormat>{ horizontalAlignment: "RIGHT" }),
                    },
                    {
                        userEnteredValue: { formulaValue: `=${n.getEffectivePointsFormulaForSpreadsheet()}` },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { formulaValue: `=${n.getPercentageFundedFormulaForSpreadsheet()}` },
                        userEnteredFormat: Object.assign({}, pendingEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
                    },
                    {
                        userEnteredFormat: borderLeft,
                    }
                ],
            };
            return rowData;
        });
        return headerRows.concat(entryRows).concat(getBorderRowBelow(7));
    }
}

export abstract class GameRequestEntry {
    public constructor(
        public readonly gameName: string,
        public readonly gameLengthHours: number,
        /** overrides the calculated activation requirement if supplied */
        protected readonly _pointsToActivate: number | undefined,
        public readonly contributions: { name: string, points: number }[]) {
    }

    public get pointsContributed(): number {
        return this.contributions.reduce<number>((prev, current, _index) => {
            return prev + current.points;
        }, 0);
    }

    public get pointsToActivate(): number {
        return this._pointsToActivate ?? ChannelPointRequests.getGameRequestPrice(this.gameLengthHours);
    }

    public abstract get effectivePoints(): number;
    public abstract get percentageFunded(): number;
}

export class GameRequest_ActiveEntry extends GameRequestEntry {
    public readonly requestDate: Date;
    
    public constructor(args: {
        gameName: string,
        gameLengthHours: number,
        requestDate: Date,
        /** overrides the calculated activation requirement if supplied */
        pointsToActivate: number | undefined,
        contributions: { name: string, points: number }[]
    }) {
        super(args.gameName, args.gameLengthHours, args.pointsToActivate, args.contributions);
        this.requestDate = args.requestDate;
    }

    public override get effectivePoints(): number {
        const elapsedMilliseconds = Date.now() - this.requestDate.getTime();
        const elapsedYears = elapsedMilliseconds / (1000 * 60 * 60 * 24 * 365);
        return this.pointsContributed * Math.pow(2, elapsedYears);
    }

    public override get percentageFunded(): number {
        return this.effectivePoints / this.pointsToActivate;
    }

    public getEffectivePointsFormulaForSpreadsheet(): string {
        const dateDifferenceFormula = `NOW()-(${getDatetimeFormulaForSpreadsheet(this.requestDate)})`;
        const elapsedYearsFormula = `int(${dateDifferenceFormula}) / 365`;
        const effectivePointsFormula = `${this.pointsContributed} * POW(2, ${elapsedYearsFormula})`;
        return effectivePointsFormula;
    }

    public getPercentageFundedFormulaForSpreadsheet(): string {
        const effectivePointsReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()-1))`;
        const pointsRequiredToActivateReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()-3))`
        return `${effectivePointsReferenceFormula} / ${pointsRequiredToActivateReferenceFormula}`;
    }
}

export class GameRequest_PendingBlock extends SpreadsheetBlock {
    public headers: SpreadsheetRow[];
    public entries: GameRequest_PendingEntry[];

    public constructor(args: {
        headers: SpreadsheetRow[],
        entries: GameRequest_PendingEntry[],
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
                return a.gameLengthHours - b.gameLengthHours; // sort ascending
            } else {
                return percentageComparison;
            }
        }).map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.gameLengthHours },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} • ${c.points}`).join("\n"),
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsToActivate, },
                        userEnteredFormat: pendingEntryFormat,
                    },
                    {
                        userEnteredValue: { numberValue: n.percentageFunded, },
                        userEnteredFormat: Object.assign({}, pendingEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
                    },
                    {
                        userEnteredFormat: borderLeft,
                    },
                ],
            };
            return rowData;
        });
        return headerRows.concat(entryRows).concat([getBorderRowBelow(5)]);
    }
}

export class GameRequest_PendingEntry extends GameRequestEntry {
    public constructor(
        args: {
            gameName: string,
            gameLengthHours: number,
            /** overrides the calculated activation requirement if supplied */
            pointsToActivate: number | undefined,
            contributions: { name: string, points: number }[],
        }) {
        super(args.gameName, args.gameLengthHours, args.pointsToActivate, args.contributions);
    }

    public override get percentageFunded(): number {
        return this.pointsContributed / this.pointsToActivate;
    }

    public override get effectivePoints(): number {
        return this.pointsContributed;
    }
}

export function parseGameRequestActiveBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_ActiveBlock {
    const headerRows = [
        parseHeaderFooterRow(rows[0]),
        parseHeaderFooterRow(rows[1]),
    ];

    const entries: GameRequest_ActiveEntry[] = [];
    for (let i = 2; i < rows.length; i++) {
        const entry = parseGameRequestActiveEntry(rows[i]);
        entries.push(entry);
    }
    
    const activeBlock = new GameRequest_ActiveBlock({
        headers: headerRows,
        entries: entries,
    });
    return activeBlock;
}

export function parseGameRequestActiveEntry(row: sheets_v4.Schema$RowData): GameRequest_ActiveEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const gameName = getEntryValue_String(row.values[0]);
    const gameLengthHours = getEntryValue_Number(row.values[1]);
    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    const pointsToActivate = row.values[3]
        ? getEntryValue_Number(row.values[3])
        : undefined;
    const requestDate = row.values[4].note
        ? new Date(row.values[4].note)
        : getEntryValue_Date(row.values[4]);

    if (!gameName || !gameLengthHours || !requestDate) {
        throw new Error("Required properties not found when parsing active game request entry: gameName, gameLengthHours, requestDate");
    }

    const entry = new GameRequest_ActiveEntry({
        gameName,
        gameLengthHours,
        pointsToActivate,
        contributions,
        requestDate,
    });
    return entry;
}

export function parseGameRequestPendingBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_PendingBlock {
    const headerRows = [
        parseHeaderFooterRow(rows[0]),
        parseHeaderFooterRow(rows[1]),
    ];

    const entries: GameRequest_PendingEntry[] = [];
    for (let i = 2; i < rows.length; i++) {
        const entry = parseGameRequestPendingEntry(rows[i]);
        entries.push(entry);
    }
    
    const activeBlock = new GameRequest_PendingBlock({
        headers: headerRows,
        entries: entries,
    });
    return activeBlock;
}

export function parseGameRequestPendingEntry(row: sheets_v4.Schema$RowData): GameRequest_PendingEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const gameName = getEntryValue_String(row.values[0]);
    const gameLengthHours = getEntryValue_Number(row.values[1]);
    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    const pointsToActivate = row.values[3]
        ? getEntryValue_Number(row.values[3])
        : undefined;

    if (!gameName || !gameLengthHours) {
        throw new Error("Required properties not found when parsing active game request entry: gameName, gameLengthHours");
    }
    
    const entry = new GameRequest_PendingEntry({
        gameName,
        gameLengthHours,
        contributions,
        pointsToActivate,
    });

    return entry;
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