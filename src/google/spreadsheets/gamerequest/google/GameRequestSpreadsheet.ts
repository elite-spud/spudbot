import { sheets_v4 } from "googleapis";
import { extractBlockArray, headersToRowData, SheetsRowProvider } from "../../SpreadsheetBase";
import { GameRequestController } from "../GameRequestController";
import { GameRequestEntry, GameRequestEntry_IterationPhase } from "../GameRequestEntry";
import { GameRequestEntryGoogleCompleted, GameRequestEntryGoogleFunded, GameRequestEntryGoogleInProgress, GameRequestEntryGoogleSelected, GameRequestEntryGoogleUnfunded } from "./GameRequestEntryGoogle";
import { GameRequest_Spreadsheet as GameRequest_SpreadsheetV1 } from "../legacy/GameRequestSpreadsheetV1";
import { parseGameRequestEntry } from "./GameRequestEntryGoogle_Parsing";

export enum GameRequest_Spreadsheet_BlockOrder {
    Completed = 0,
    InProgress = 1,
    Funded = 2,
    Unfunded = 3,
}

export class GameRequest_Spreadsheet implements SheetsRowProvider {
    protected readonly _controller: GameRequestController;

    public constructor(controller: GameRequestController) {
        this._controller = controller;
    }

    public static fromV1Spreadsheet(sheet: GameRequest_SpreadsheetV1): GameRequest_Spreadsheet {
        const completedEntries = sheet.completedBlock.entries.map(n => GameRequestEntry.fromV1Completed(n));
        const startedEntries = sheet.inProgressBlock.entries.map(n => GameRequestEntry.fromV1Started(n));
        const fundedEntries = sheet.fundedBlock.entries.map(n => GameRequestEntry.fromV1Funded(n));
        const unfundedEntries = sheet.unfundedBlock.entries.map(n => GameRequestEntry.fromV1Unfunded(n));
        const entries = [
            ...completedEntries,
            ...startedEntries,
            ...fundedEntries,
            ...unfundedEntries,
        ];

        const controller = new GameRequestController(entries, true);
        const spreadsheet = new GameRequest_Spreadsheet(controller);
        return spreadsheet;
    }

    public toRowData(): sheets_v4.Schema$RowData[] {
        const unfundedEntries   = this._controller.entries.filter(n => n.currentIteration.phase === GameRequestEntry_IterationPhase.Unfunded);
        const fundedEntries     = this._controller.entries.filter(n => n.currentIteration.phase === GameRequestEntry_IterationPhase.Funded);
        const selectedEntries   = this._controller.entries.filter(n => n.currentIteration.phase === GameRequestEntry_IterationPhase.Selected);
        const inProgressEntries = this._controller.entries.filter(n => n.currentIteration.phase === GameRequestEntry_IterationPhase.InProgress);
        const completedEntries  = this._controller.entries.filter(n => n.currentIteration.phase === GameRequestEntry_IterationPhase.Completed);

        const sortByPercentageFundedDesc = (a: GameRequestEntry, b: GameRequestEntry) => {
            return a.currentIteration.percentageFunded - b.currentIteration.percentageFunded;
        };
        const sortByDateSelectedDesc = (a: GameRequestEntry, b: GameRequestEntry) => {
            return a.currentIteration.dateSelected!.getTime() - b.currentIteration.dateSelected!.getTime();
        };
        const sortByDateCompletedAsc = (a: GameRequestEntry, b: GameRequestEntry) => {
            return b.currentIteration.dateCompleted!.getTime() - a.currentIteration.dateCompleted!.getTime();
        };

        const unfundedHeaderRows = headersToRowData(GameRequestEntryGoogleUnfunded.headers);
        const unfundedEntryRows = unfundedEntries.sort(sortByPercentageFundedDesc).map(n => new GameRequestEntryGoogleUnfunded(n).toRowData());
        const unfundedFooterRows = GameRequestEntryGoogleUnfunded.footers;

        const fundedHeaderRows = headersToRowData(GameRequestEntryGoogleFunded.headers);
        const fundedEntryRows = fundedEntries.sort(sortByPercentageFundedDesc).map(n => new GameRequestEntryGoogleFunded(n).toRowData());
        const fundedFooterRows = GameRequestEntryGoogleFunded.footers;

        const selectedHeaderRows = headersToRowData(GameRequestEntryGoogleSelected.headers);
        const selectedEntryRows = selectedEntries.sort(sortByDateSelectedDesc).map(n => new GameRequestEntryGoogleSelected(n).toRowData());
        const selectedFooterRows = GameRequestEntryGoogleSelected.footers;

        const inProgressHeaderRows = headersToRowData(GameRequestEntryGoogleInProgress.headers);
        const inProgressEntryRows = inProgressEntries.sort(sortByDateSelectedDesc).map(n => new GameRequestEntryGoogleInProgress(n).toRowData());
        const inProgressFooterRows = GameRequestEntryGoogleInProgress.footers;

        const completedHeaderRows = headersToRowData(GameRequestEntryGoogleCompleted.headers);
        const completedEntryRows = completedEntries.sort(sortByDateCompletedAsc).map(n => new GameRequestEntryGoogleCompleted(n).toRowData());
        const completedFooterRows = GameRequestEntryGoogleCompleted.footers;

        return [
            ...completedHeaderRows,
            ...completedEntryRows,
            ...completedFooterRows,
            ...inProgressHeaderRows,
            ...inProgressEntryRows,
            ...inProgressFooterRows,
            ...selectedHeaderRows,
            ...selectedEntryRows,
            ...selectedFooterRows,
            ...fundedHeaderRows,
            ...fundedEntryRows,
            ...fundedFooterRows,
            ...unfundedHeaderRows,
            ...unfundedEntryRows,
            ...unfundedFooterRows,
        ];
    }

    public static async getGameRequestSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetId: number, enableOverfunding: boolean): Promise<GameRequest_Spreadsheet> {
        const apiSpreadsheet = await sheetsApi.spreadsheets.getByDataFilter({
            spreadsheetId: sheetId,
            requestBody: {
                includeGridData: true,
                dataFilters: [
                    { gridRange: { sheetId: subSheetId } }
                ]
            }
        });
    
        if (!apiSpreadsheet.data || !apiSpreadsheet.data.sheets || apiSpreadsheet.data.sheets.length === 0) {
            throw new Error("Unable to retrieve game request spreadsheet: sheet is empty");
        }

        const entries: GameRequestEntry[] = [];
        const blocks = extractBlockArray(apiSpreadsheet.data.sheets[0]);
        for (const block of blocks) { // all blocks are presently of the same format
            const rows = block.slice(2); // first 2 rows of each block are headers
            for (const row of rows) {
                const entry = parseGameRequestEntry(row);
                entries.push(entry);
            }
        }
        const gameRequestController = new GameRequestController(entries, enableOverfunding);
        const gameRequestSpreadsheet = new GameRequest_Spreadsheet(gameRequestController);
        return gameRequestSpreadsheet;
    }
}
