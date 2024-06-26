import { sheets_v4 } from "googleapis";
import { ChannelPointRequests } from "../ChannelPointRequests";
import { SpreadsheetBlock, SpreadsheetRow, extractBlockArray, getEntryValue_Number, getEntryValue_String, parseHeaderFooterRow } from "./SpreadsheetBase";

export enum GameRequest_Spreadsheet_BlockOrder {
    Active = 0,
    Pending = 1,
}

export class GameRequest_Spreadsheet {
    public readonly activeBlock: GameRequest_ActiveBlock;
    public readonly pendingBlock: GameRequest_PendingBlock;

    public constructor(activeBlock: GameRequest_ActiveBlock, pendingBlock: GameRequest_PendingBlock) {
        this.activeBlock = activeBlock;
        this.pendingBlock = pendingBlock;
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
            const contribution = activeEntry.contributions.find(n => n.name === username) ?? { name: username, points: 0 };
            contribution.points += points;
            return;
        }
        
        const pendingEntry = this.pendingBlock.entries.find(n => n.gameName.toLowerCase() === gamename.toLowerCase());
        if (pendingEntry) {
            const contribution = pendingEntry.contributions.find(n => n.name === username) ?? { name: username, points: 0 };
            contribution.points += points;
            if (pendingEntry.pointsContributed > pendingEntry.pointsToActivate) {
                const activeEntry = new GameRequest_ActiveEntry({ gameName: pendingEntry.gameName, gameLengthHours: pendingEntry.gameLengthHours, requestDate: timestamp, contributions: Array.from(pendingEntry.contributions) });
                this.activeBlock.entries.push(activeEntry);
            }
            return;
        }

        throw new Error();
    }

    public addEntry(gameName: string, gameLengthHours: number, pointsToActivate: number | undefined, username: string, points: number, timestamp: Date): void {
        const contributions = [
            { name: username, points: 0 }
        ];
        const pendingEntry = new GameRequest_PendingEntry({ gameName, gameLengthHours, pointsToActivate, contributions });
        this.pendingBlock.entries.push(pendingEntry);
        this.addPointsToEntry(username, gameName, points, timestamp);
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
        const headerRow: sheets_v4.Schema$RowData = {
            
        };
        const entryRows = this.entries.map(_n => {
            const rowData: sheets_v4.Schema$RowData = {
                values: [
                    // { userEnteredValue: { stringValue: n.gameName } },
                    {},
                    {},
                    { note: "foo" },
                    {},
                ],
            };
            return rowData;
        });
        return [headerRow].concat(entryRows);
    }

    public override toGridData(): SpreadsheetRow[] {
        const headerValues = [this.header];
        const entryValues = this.entries.map(n => [n.gameName, n.gameLengthHours, n.pointsContributed, n.requestDate.toISOString(), n.effectivePoints] );
        return headerValues.concat(entryValues);
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

public override toGridData(): SpreadsheetRow[] {
    const headerValues = [this.header];
    const entryValues = this.entries.map(n => [n.gameName, n.gameLengthHours, n.pointsContributed, n.pointsToActivate] );
    return headerValues.concat(entryValues);
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
    for (let i = 1; i < rows.length - 1; i++) {
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
    const contributions = contributionsString.split("\n").map(n => { 
        const tokens = n.split(" ");
        const name = tokens[0];
        const points = Number.parseInt(tokens[2]);
        return { name: name, points: points };
    });
    const entry = new GameRequest_ActiveEntry({
        gameName: getEntryValue_String(row.values[0]),
        gameLengthHours: getEntryValue_Number(row.values[1]),
        contributions: contributions,
        requestDate: new Date(getEntryValue_String(row.values[3])),
    });

    return entry;
}

export function parseGameRequestPendingBlock(rows: sheets_v4.Schema$RowData[]): GameRequest_PendingBlock {
    const headerRow = parseHeaderFooterRow(rows[0]);

    const entries: GameRequest_PendingEntry[] = [];
    for (let i = 1; i < rows.length - 1; i++) {
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
    const contributions = contributionsString.split("\n").map(n => { 
        const tokens = n.split(" ");
        const name = tokens[0];
        const points = Number.parseInt(tokens[2]);
        return { name: name, points: points };
    });
    const entry = new GameRequest_PendingEntry({
        gameName: getEntryValue_String(row.values[0]),
        gameLengthHours: getEntryValue_Number(row.values[1]),
        contributions: contributions,
        pointsToActivate: getEntryValue_Number(row.values[3]),
    });

    return entry;
}

export async function getGameRequestSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetName: string): Promise<GameRequest_Spreadsheet> {
    const apiSpreadsheet = await sheetsApi.spreadsheets.get({
        includeGridData: true,
        ranges: [subSheetName],
        spreadsheetId: sheetId,
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

    const gameRequestSpreadsheet = new GameRequest_Spreadsheet(activeBlock, pendingBlock);
    return gameRequestSpreadsheet;
}

export async function pushGameRequestSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, _subSheetName: string, gameRequestSpreadsheet: GameRequest_Spreadsheet): Promise<void> {    
    const pendingBlockValues = gameRequestSpreadsheet.pendingBlock.toGridData();
    const activeBlockValues = gameRequestSpreadsheet.activeBlock.toGridData();
    
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
        ]
    };
    await sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: batchUpdateRequest,
    });

    const batchSheetUpdateRequest: sheets_v4.Schema$Request = {
        updateCells: {
            rows: gameRequestSpreadsheet.activeBlock.toRowData(),
        }
    };
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [batchSheetUpdateRequest] },
    });
}