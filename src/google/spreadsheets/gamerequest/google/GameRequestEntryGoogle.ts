import { sheets_v4 } from "googleapis";
import { Utils } from "../../../../Utils";
import { getDatetimeFormulaForSpreadsheet, SpreadsheetRow } from "../../SpreadsheetBase";
import { GameRequestEntry } from "../GameRequestEntry";
import { basicDateFormat, basicEntryFormat, borderLeft, getBorderRowBelow } from "../../SpreadsheetBaseStyle";
import { getWaitTimeMultiplierFormulaForSpreadsheet } from "../GameRequestUtils";

export abstract class GameRequestEntryGoogle {
    protected readonly _entry: GameRequestEntry;

    public constructor(entry: GameRequestEntry) {
        this._entry = entry;
    }

    public abstract toRowData(): sheets_v4.Schema$RowData;

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
        const waitTimeMultiplierFormula = this._entry.currentIteration.isFunded
            ? getWaitTimeMultiplierFormulaForSpreadsheet(dateFundedCellOffset, dateSelectedCellOffset)
            : 1;
        return {
            userEnteredValue: { formulaValue: `=${waitTimeMultiplierFormula}` },
            userEnteredFormat: basicEntryFormat,
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
                `${c.timestamp} • ${c.points} • ${c.name} • ${c.id}`).join("\n")).join("\n\n");
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
            ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Date Funded", "Date Selected", "Wait Time Multiplier", "Date Started", "Date Completed", "Date Requested", "Requested By"],
        ];
    public static footers: sheets_v4.Schema$RowData[] = [getBorderRowBelow(11)];

    public toRowData(): sheets_v4.Schema$RowData {
        const rowData: sheets_v4.Schema$RowData = {
            values: [
                this.getCell_GameName(),
                this.getCell_HoursPlayed(),
                this.getCell_PointsContributedOverall(),
                this.getCell_PercentageFundedOverall(),
                this.getCell_DateFunded(),
                this.getCell_DateSelected(),
                this.getCell_WaitTimeMultiplier(-2, -1),
                this.getCell_DateStarted(),
                this.getCell_DateCompleted(),
                this.getCell_DateRequested(),
                this.getCell_RequestorName(),
                this.getCell_BorderRight(),
            ],
        };
        return rowData;
    }
}

export class GameRequestEntryGoogleFunded extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Funded Requests"],
            ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Date Funded", "Date Selected", "Wait Time Multiplier", "Date Started", "Date Completed", "Date Requested", "Requested By"],
        ];
    public static footers: sheets_v4.Schema$RowData[] = [getBorderRowBelow(11)];

    public toRowData(): sheets_v4.Schema$RowData {
        const rowData: sheets_v4.Schema$RowData = {
            values: [
                this.getCell_GameName(),
                this.getCell_HoursPlayed(),
                this.getCell_PointsContributedOverall(),
                this.getCell_PercentageFundedOverall(),
                this.getCell_DateFunded(),
                this.getCell_DateSelected(),
                this.getCell_WaitTimeMultiplier(-2, -1),
                this.getCell_DateStarted(),
                this.getCell_DateCompleted(),
                this.getCell_DateRequested(),
                this.getCell_RequestorName(),
                this.getCell_BorderRight(),
            ],
        };
        return rowData;
    }
}

export class GameRequestEntryGoogleSelected extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Selected Requests"],
            ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Date Funded", "Date Selected", "Wait Time Multiplier", "Date Started", "Date Completed", "Date Requested", "Requested By"],
        ];
    public static footers: sheets_v4.Schema$RowData[] = [getBorderRowBelow(11)];

    public toRowData(): sheets_v4.Schema$RowData {
        const rowData: sheets_v4.Schema$RowData = {
            values: [
                this.getCell_GameName(),
                this.getCell_HoursPlayed(),
                this.getCell_PointsContributedOverall(),
                this.getCell_PercentageFundedOverall(),
                this.getCell_DateFunded(),
                this.getCell_DateSelected(),
                this.getCell_WaitTimeMultiplier(-2, -1),
                this.getCell_DateStarted(),
                this.getCell_DateCompleted(),
                this.getCell_DateRequested(),
                this.getCell_RequestorName(),
                this.getCell_BorderRight(),
            ],
        };
        return rowData;
    }
}

export class GameRequestEntryGoogleInProgress extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["In Progress Requests"],
            ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Date Funded", "Date Selected", "Wait Time Multiplier", "Date Started", "Date Completed", "Date Requested", "Requested By"],
        ];
    public static footers: sheets_v4.Schema$RowData[] = [getBorderRowBelow(11)];

    public toRowData(): sheets_v4.Schema$RowData {
        const rowData: sheets_v4.Schema$RowData = {
            values: [
                this.getCell_GameName(),
                this.getCell_HoursPlayed(),
                this.getCell_PointsContributedOverall(),
                this.getCell_PercentageFundedOverall(),
                this.getCell_DateFunded(),
                this.getCell_DateSelected(),
                this.getCell_WaitTimeMultiplier(-2, -1),
                this.getCell_DateStarted(),
                this.getCell_DateCompleted(),
                this.getCell_DateRequested(),
                this.getCell_RequestorName(),
                this.getCell_BorderRight(),
            ],
        };
        return rowData;
    }
}

export class GameRequestEntryGoogleCompleted extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Completed Requests"],
            ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Date Funded", "Date Selected", "Wait Time Multiplier", "Date Started", "Date Completed", "Date Requested", "Requested By"],
        ];
    public static footers: sheets_v4.Schema$RowData[] = [getBorderRowBelow(11)];

    public toRowData(): sheets_v4.Schema$RowData {
        const rowData: sheets_v4.Schema$RowData = {
            values: [
                this.getCell_GameName(),
                this.getCell_HoursPlayed(),
                this.getCell_PointsContributedOverall(),
                this.getCell_PercentageFundedOverall(),
                this.getCell_DateFunded(),
                this.getCell_DateSelected(),
                this.getCell_WaitTimeMultiplier(-2, -1),
                this.getCell_DateStarted(),
                this.getCell_DateCompleted(),
                this.getCell_DateRequested(),
                this.getCell_RequestorName(),
                this.getCell_BorderRight(),
            ],
        };
        return rowData;
    }
}