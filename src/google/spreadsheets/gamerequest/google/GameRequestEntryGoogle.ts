import { sheets_v4 } from "googleapis";
import { Utils } from "../../../../Utils";
import { getCell_Empty, getDatetimeFormulaForSpreadsheet, SpreadsheetRow } from "../../SpreadsheetBase";
import { basicDateFormat, basicEntryFormat, borderLeft, decimalNumberFormat, getBorderRowBelow } from "../../SpreadsheetBaseStyle";
import { GameRequestEntry } from "../GameRequestEntry";
import { getWaitTimeMultiplierFormulaForSpreadsheet } from "../GameRequestUtils";
import { parseGameRequestEntry } from "./GameRequestEntryGoogle_Parsing";

export abstract class GameRequestEntryGoogle {
    protected readonly _entry: GameRequestEntry;

    public constructor(entry: GameRequestEntry) {
        this._entry = entry;
    }

    public static readonly columnHeader: SpreadsheetRow = ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Wait Time Multiplier", "Effective % Funded", "Date Requested", "Date Funded", "Date Selected", "Date Started", "Date Completed", "Requested By"];
    public static footers: sheets_v4.Schema$RowData[] = [getBorderRowBelow(12)];


    public toRowData(): sheets_v4.Schema$RowData {
        const rowData: sheets_v4.Schema$RowData = {
            values: [
                this.getCell_GameName(),
                this.getCell_HoursPlayed(),
                this.getCell_PointsContributed(),
                this.getCell_PercentageFunded(),
                this.getCell_WaitTimeMultiplier(3, 4),
                this.getCell_percentageFundedEffective(),
                this.getCell_DateRequested(),
                this._entry.currentIteration.isFunded ? this.getCell_DateFunded() : getCell_Empty(),
                this._entry.currentIteration.isSelected ? this.getCell_DateSelected() : getCell_Empty(),
                this._entry.currentIteration.isStarted ? this.getCell_DateStarted() : getCell_Empty(),
                this._entry.currentIteration.isCompleted ? this.getCell_DateCompleted() : getCell_Empty(),
                this.getCell_RequestorName(),
                this.getCell_BorderRight(),
            ],
        };
        return rowData;
    }

    public static fromRowData(rowData: sheets_v4.Schema$RowData): GameRequestEntry {
        return parseGameRequestEntry(rowData);
    }

    public getCell_GameName(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { stringValue: this._entry.gameName },
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_HoursPlayed(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.hoursPlayed },
            note: `${this._entry.iterations.map(i => `${i.estimatedGameLengthHours} • ${i.hoursPlayed}`).join("\n")}`,
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_PointsContributed(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.currentIteration.pointsContributed },
            note: this.getContributionsString(),
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_PointsContributedOverall(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.pointsContributed },
            note: this.getContributionsString(),
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_PercentageFunded(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.currentIteration.percentageFunded },
            note: this._entry.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_percentageFundedEffective(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.currentIteration.percentageFundedEffective },
            note: this._entry.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_PercentageFundedOverall(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.percentageFunded },
            note: this._entry.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_PercentageFundedEffectiveOverall(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this._entry.percentageFundedEffective },
            note: this._entry.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_DateFunded(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this._entry.currentIteration.dateFunded!)}` },
            note: this._entry.iterations.map(i => i.dateFunded?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }
    
    public getCell_DateSelected(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this._entry.currentIteration.dateSelected!)}` },
            note: this._entry.iterations.map(i => i.dateSelected?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_WaitTimeMultiplier(dateFundedCellOffset: number, dateSelectedCellOffset: number): sheets_v4.Schema$CellData {
        const waitTimeMultiplierFormula = this._entry.currentIteration.isSelected
            ? getWaitTimeMultiplierFormulaForSpreadsheet(dateFundedCellOffset, dateSelectedCellOffset)
            : this._entry.currentIteration.isFunded
                ? getWaitTimeMultiplierFormulaForSpreadsheet(dateFundedCellOffset)
                : 1;
        return {
            userEnteredValue: { formulaValue: `=${waitTimeMultiplierFormula}` },
            userEnteredFormat: decimalNumberFormat,
        };
    }

    public getCell_DateStarted(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this._entry.currentIteration.dateStarted!)}` },
            note: this._entry.iterations.map(i => i.dateStarted?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_DateCompleted(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this._entry.currentIteration.dateCompleted!)}` },
            note: this._entry.iterations.map(i => i.dateCompleted?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_DateRequested(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this._entry.currentIteration.dateRequested)}` },
            note: this._entry.iterations.map(i => `${i.dateRequested.toISOString()}`).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_RequestorName(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { stringValue: this._entry.currentIteration.requestorName, },
            note: this._entry.iterations.map(i => `${i.requestorName} • ${i.requestorName}`).join("\n"),
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_BorderRight(): sheets_v4.Schema$CellData {
        return {
            userEnteredFormat: borderLeft,
        };
    }

    protected getHoursPlayedString(): string {
        return `${this._entry.iterations.map(i => `${i.estimatedGameLengthHours} • ${i.hoursPlayed}`).join("\n")}`
    }

    protected getContributionsString(): string {
        return this._entry.iterations.map(i =>
            i.contributions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).map(c =>
                `${c.timestamp.toISOString()} • ${c.points} • ${c.name} • ${c.id}`).join("\n")).join("\n\n");
    }

    protected parseUtcDates(datesString: string): Date[] {
        const dates = datesString.split("\n").map(n => Utils.getDateFromUtcTimestring(n));
        return dates;
    }
}

export class GameRequestEntryGoogleUnfunded extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Unfunded Requests"],
            GameRequestEntryGoogle.columnHeader,
        ];
}

export class GameRequestEntryGoogleFunded extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Unfunded Requests"],
            GameRequestEntryGoogle.columnHeader,
        ];
}

export class GameRequestEntryGoogleSelected extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Selected Requests"],
            GameRequestEntryGoogle.columnHeader,
        ];
}

export class GameRequestEntryGoogleInProgress extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["In Progress Requests"],
            GameRequestEntryGoogle.columnHeader,
        ];
}

export class GameRequestEntryGoogleCompleted extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Completed Requests"],
            GameRequestEntryGoogle.columnHeader,
        ];
}
