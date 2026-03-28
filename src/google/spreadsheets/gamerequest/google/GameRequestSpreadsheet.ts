import { sheets_v4 } from "googleapis";
import { headersToRowData, SheetsRowProvider } from "../../SpreadsheetBase";
import { GameRequestController } from "../GameRequestController";
import { GameRequestEntry, GameRequestEntry_IterationPhase } from "../GameRequestEntry";
import { GameRequestEntryGoogleCompleted, GameRequestEntryGoogleFunded, GameRequestEntryGoogleInProgress, GameRequestEntryGoogleSelected, GameRequestEntryGoogleUnfunded } from "./GameRequestEntryGoogle";
import { GameRequest_Spreadsheet as GameRequest_SpreadsheetV1 } from "../legacy/GameRequestSpreadsheetV1";

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

        const unfundedHeaderRows = headersToRowData(GameRequestEntryGoogleUnfunded.headers);
        const unfundedEntryRows = unfundedEntries.map(n => new GameRequestEntryGoogleUnfunded(n).toRowData());
        const unfundedFooterRows = GameRequestEntryGoogleUnfunded.footers;

        const fundedHeaderRows = headersToRowData(GameRequestEntryGoogleFunded.headers);
        const fundedEntryRows = fundedEntries.map(n => new GameRequestEntryGoogleFunded(n).toRowData());
        const fundedFooterRows = GameRequestEntryGoogleFunded.footers;

        const selectedHeaderRows = headersToRowData(GameRequestEntryGoogleSelected.headers);
        const selectedEntryRows = selectedEntries.map(n => new GameRequestEntryGoogleSelected(n).toRowData());
        const selectedFooterRows = GameRequestEntryGoogleSelected.footers;

        const inProgressHeaderRows = headersToRowData(GameRequestEntryGoogleInProgress.headers);
        const inProgressEntryRows = inProgressEntries.map(n => new GameRequestEntryGoogleInProgress(n).toRowData());
        const inProgressFooterRows = GameRequestEntryGoogleInProgress.footers;

        const completedHeaderRows = headersToRowData(GameRequestEntryGoogleCompleted.headers);
        const completedEntryRows = completedEntries.map(n => new GameRequestEntryGoogleCompleted(n).toRowData());
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
}

// export function buildIterations(requestorNames: string[], requestorIds: string[], datesRequested: Date[], datesFunded: (Date | undefined)[], datesStarted: (Date | undefined)[], datesCompleted: (Date | undefined)[]): GameRequestIteration[] {
//     const lengths = [requestorNames.length, requestorIds.length, datesRequested.length, datesFunded.length, datesStarted.length, datesCompleted.length];
//     const arraysSameLength = lengths.every(n => n === datesRequested.length);
//     if (!arraysSameLength) {
//         throw new Error(`Cannot build iteration unless all arrays are same length (expected ${requestorNames.length})`);
//     }

//     const iterations: GameRequestIteration[] = [];
//     for (let i = 0; i < datesRequested.length; i++) {
//         const iteration = {
//             originalRequestorId: requestorIds[i],
//             originalRequestorName: requestorNames[i],
//             dateRequested: datesRequested[i],
//             dateFunded: datesFunded[i],
//             dateStarted: datesStarted[i],
//             dateCompleted: datesCompleted[i],
//         } as GameRequestIteration;
//         iterations.push(iteration);
//     }
//     iterations.sort((a, b) => a.dateRequested.getTime() - b.dateRequested.getTime()) // ensure iterations are always sorted by 
//     return iterations;
// }
