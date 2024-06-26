import { sheets_v4 } from "googleapis";
import { ChannelPointRequests } from "../ChannelPointRequests";
import { SpreadsheetBase, SpreadsheetBlock, SpreadsheetRow, extractBlockArray, getEntryValue_Date, getEntryValue_Number, getEntryValue_String, parseHeaderFooterRow, simpleToRowData } from "./SpreadsheetBase";

export enum GameRequest_Spreadsheet_BlockOrder {
    Active = 0,
    Pending = 1,
}

export class GameRequest_Spreadsheet extends SpreadsheetBase {
    public readonly activeBlock: GameRequest_ActiveBlock;
    public readonly pendingBlock: GameRequest_PendingBlock;

    public constructor(args: {
        sheetId: string,
        subSheetId: number,
        activeBlock: GameRequest_ActiveBlock,
        pendingBlock: GameRequest_PendingBlock
    }) {
        super();
        this.activeBlock = args.activeBlock;
        this.pendingBlock = args.pendingBlock;
    }

    public findEntry(gamename: string): GameRequestEntry | undefined {
        const activeEntry = this.activeBlock.entries.find(n => n.gameName.toLowerCase() === gamename.toLowerCase());
        if (activeEntry) {
            return activeEntry;
        }

        const pendingEntry = this.pendingBlock.entries.find(n => n.gameName.toLowerCase() === gamename.toLowerCase());
        if (pendingEntry) {
            return pendingEntry;
        }

        return undefined;
    }

    public addPointsToEntry(username: string, gamename: string, points: number, timestamp: Date): void {
        const activeEntry = this.activeBlock.entries.find(n => n.gameName.toLowerCase() === gamename.toLowerCase());
        if (activeEntry) {
            let contribution = activeEntry.contributions.find(n => n.name === username);
            if (!contribution) {
                contribution = { name: username, points: 0 };
                activeEntry.contributions.push(contribution);
            }
            contribution.points += points;
            return;
        }
        
        const pendingEntryIndex = this.pendingBlock.entries.findIndex(n => n.gameName.toLowerCase() === gamename.toLowerCase());
        if (pendingEntryIndex !== -1) {
            const pendingEntry = this.pendingBlock.entries.at(pendingEntryIndex)!;
            let contribution = pendingEntry.contributions.find(n => n.name === username); // ?? { name: username, points: 0 };
            if (!contribution) {
                contribution = { name: username, points: 0 };
                pendingEntry.contributions.push(contribution);
            }
            contribution.points += points;

            if (pendingEntry.pointsContributed >= pendingEntry.pointsToActivate) {         
                const activeEntry = new GameRequest_ActiveEntry({ gameName: pendingEntry.gameName, gameLengthHours: pendingEntry.gameLengthHours, requestDate: timestamp, contributions: Array.from(pendingEntry.contributions) });
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
        return this.activeBlock.toRowData().concat({}).concat(this.pendingBlock.toRowData());
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
        for (let i = 0; i < 3; i++) {
            if (i === GameRequest_Spreadsheet_BlockOrder.Active) {
                activeBlock = parseGameRequestActiveBlock(blockArray[i]);
            } else if (i === GameRequest_Spreadsheet_BlockOrder.Pending) {
                pendingBlock = parseGameRequestPendingBlock(blockArray[i]);
            }
        }
    
        if (!activeBlock || !pendingBlock) {
            throw new Error("Unable to parse discrete blocks from game request spreadsheet");
        }
    
        const gameRequestSpreadsheet = new GameRequest_Spreadsheet({ sheetId, subSheetId, activeBlock, pendingBlock });
        return gameRequestSpreadsheet;
    }
}

export class GameRequest_ActiveBlock extends SpreadsheetBlock {
    public header: SpreadsheetRow;
    public entries: GameRequest_ActiveEntry[];

    public constructor(args: {
            header: SpreadsheetRow,
            entries: GameRequest_ActiveEntry[],
        }) {
        super();
        this.header = args.header;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRow = simpleToRowData(this.header);
        const entryRows = this.entries.map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                    },
                    {
                        userEnteredValue: { numberValue: n.gameLengthHours },
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} - ${c.points}`).join("\n"),
                    },
                    {
                        userEnteredValue: { stringValue: n.requestDate.toISOString(), },
                    },
                    {
                        userEnteredValue: { numberValue: n.effectivePoints, },
                    },
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows);
    }
}

export abstract class GameRequestEntry {
    public constructor(
        public readonly contributions: { name: string, points: number }[]) {
    }

    public get pointsContributed(): number {
        return this.contributions.reduce<number>((prev, current, _index) => {
            return prev + current.points;
        }, 0);
    }
}

export class GameRequest_ActiveEntry extends GameRequestEntry {
    public readonly gameName: string;
    public readonly gameLengthHours: number;
    public readonly requestDate: Date;
    
    public constructor(args: {
        gameName: string,
        gameLengthHours: number,
        requestDate: Date,
        contributions: { name: string, points: number }[]
    }) {
        super(args.contributions);
        this.gameName = args.gameName;
        this.gameLengthHours = args.gameLengthHours;
        this.requestDate = args.requestDate;
    }

    public get effectivePoints(): number {
        return this.pointsContributed; // TODO: determine a formula for this
    }
}

export class GameRequest_PendingBlock extends SpreadsheetBlock {
    public header: SpreadsheetRow;
    public entries: GameRequest_PendingEntry[];

    public constructor(args: {
        header: SpreadsheetRow,
        entries: GameRequest_PendingEntry[],
    }) {
        super();
        this.header = args.header;
        this.entries = args.entries;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const headerRow = simpleToRowData(this.header);
        const entryRows = this.entries.map(n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    {
                        userEnteredValue: { stringValue: n.gameName },
                    },
                    {
                        userEnteredValue: { numberValue: n.gameLengthHours },
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsContributed },
                        note: n.contributions.sort((a, b) => b.points - a.points).map(c => `${c.name} - ${c.points}`).join("\n"),
                    },
                    {
                        userEnteredValue: { numberValue: n.pointsToActivate, },
                    },
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows);
    }
}

export class GameRequest_PendingEntry extends GameRequestEntry {
    public readonly gameName: string;
    public readonly gameLengthHours: number;
    /** overrides the calculated activation requirement if supplied */
    protected readonly _pointsToActivate: number | undefined;
    
    public constructor(
        args: {
            gameName: string,
            gameLengthHours: number,
            /** overrides the calculated activation requirement if supplied */
            pointsToActivate: number | undefined,
            contributions: { name: string, points: number }[],
        }) {
        super(args.contributions);
        this.gameName = args.gameName;
        this.gameLengthHours = args.gameLengthHours;
        this._pointsToActivate = args.pointsToActivate;
    }

    public get pointsToActivate(): number {
        return this._pointsToActivate ?? ChannelPointRequests.getGameRequestPrice(this.gameLengthHours);
    }
}

export function parseGameRequestActiveBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_ActiveBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: GameRequest_ActiveEntry[] = [];
    for (let i = 1; i < rows.length; i++) {
        const entry = parseGameRequestActiveEntry(rows[i]);
        entries.push(entry);
    }
    
    const activeBlock = new GameRequest_ActiveBlock({
        header: headerRow,
        entries: entries,
    });
    return activeBlock;
}

export function parseGameRequestActiveEntry(row: sheets_v4.Schema$RowData): GameRequest_ActiveEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);

    const entry = new GameRequest_ActiveEntry({
        gameName: getEntryValue_String(row.values[0]),
        gameLengthHours: getEntryValue_Number(row.values[1]),
        contributions: contributions,
        requestDate: getEntryValue_Date(row.values[3]),
    });

    return entry;
}

export function parseGameRequestPendingBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_PendingBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: GameRequest_PendingEntry[] = [];
    for (let i = 1; i < rows.length; i++) {
        const entry = parseGameRequestPendingEntry(rows[i]);
        entries.push(entry);
    }
    
    const activeBlock = new GameRequest_PendingBlock({
        header: headerRow,
        entries: entries,
    });
    return activeBlock;
}

export function parseGameRequestPendingEntry(row: sheets_v4.Schema$RowData): GameRequest_PendingEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }
    // TODO: enforce a length at least as long as is required

    const contributionsString = row.values[2].note ?? "";
    const contributions = parseContributions(contributionsString);
    
    const entry = new GameRequest_PendingEntry({
        gameName: getEntryValue_String(row.values[0]),
        gameLengthHours: getEntryValue_Number(row.values[1]),
        contributions: contributions,
        pointsToActivate: getEntryValue_Number(row.values[3]),
    });

    return entry;
}

export function parseContributions(contributionsString: string): { name: string, points: number }[] {
    if (!contributionsString) {
        return [];
    }

    const contributions = contributionsString.split("\n").map(n => { 
        const tokens = n.split(" ");
        const name = tokens[0];
        const points = Number.parseInt(tokens[2]);
        return { name: name, points: points };
    });
    return contributions;
}