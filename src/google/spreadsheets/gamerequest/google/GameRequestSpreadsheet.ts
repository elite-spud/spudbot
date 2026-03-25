import { sheets_v4 } from "googleapis";
import { SpreadsheetBase, headersToRowData } from "../../SpreadsheetBase";
import { GameRequestController } from "../GameRequestController";
import { GameRequestEntry_IterationPhase } from "../GameRequestEntry";
import { GameRequestEntryGoogleCompleted, GameRequestEntryGoogleFunded, GameRequestEntryGoogleInProgress, GameRequestEntryGoogleSelected, GameRequestEntryGoogleUnfunded } from "./GameRequestEntryGoogle";

export enum GameRequest_Spreadsheet_BlockOrder {
    Completed = 0,
    InProgress = 1,
    Funded = 2,
    Unfunded = 3,
}

export class GameRequest_Spreadsheet extends SpreadsheetBase {
    protected readonly _controller: GameRequestController;

    public constructor(controller: GameRequestController) {
        super();
        this._controller = controller;
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
            ...unfundedHeaderRows,
            ...unfundedEntryRows,
            ...unfundedFooterRows,
            ...fundedHeaderRows,
            ...fundedEntryRows,
            ...fundedFooterRows,
            ...selectedHeaderRows,
            ...selectedEntryRows,
            ...selectedFooterRows,
            ...inProgressHeaderRows,
            ...inProgressEntryRows,
            ...inProgressFooterRows,
            ...completedHeaderRows,
            ...completedEntryRows,
            ...completedFooterRows,
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
