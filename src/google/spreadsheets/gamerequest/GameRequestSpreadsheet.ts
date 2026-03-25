import { sheets_v4 } from "googleapis";
import { SpreadsheetBase, headersToRowData } from "../SpreadsheetBase";
import { GameRequestController } from "./GameRequestController";
import { GameRequestEntryGoogleCompleted } from "./GameRequestEntryGoogle";

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
        const headerRows = headersToRowData(GameRequestEntryGoogleCompleted.headers);
        const entryRows = this._controller.entries.map(n => (n as GameRequestEntryGoogleCompleted).toRowData());
        const footerRows = this._controller.entries.map(n => (n as GameRequestEntryGoogleCompleted).toRowData());
        return headerRows.concat(entryRows).concat(footerRows);
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
