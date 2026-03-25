import { sheets_v4 } from "googleapis";
import { Utils } from "../../../Utils";
import { getDatetimeFormulaForSpreadsheet, SpreadsheetRow } from "../SpreadsheetBase";
import { GameRequestEntry } from "./GameRequestEntry";
import { basicDateFormat, basicEntryFormat, borderLeft, getBorderRowBelow } from "../SpreadsheetBaseStyle";
import { getWaitTimeMultiplierFormulaForSpreadsheet } from "./GameRequestUtils";

export abstract class GameRequestEntryGoogle extends GameRequestEntry {

    public abstract toRowData(): sheets_v4.Schema$RowData;

    public getCell_GameName(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { stringValue: this.gameName },
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_HoursPlayed(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.hoursPlayed },
            note: `${this.iterations.map(i => `${i.estimatedGameLengthHours} • ${i.hoursPlayed}`).join("\n")}`,
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_PointsContributed(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.currentIteration.pointsContributed },
            note: this.getContributionsString(),
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_PointsContributedOverall(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.pointsContributed },
            note: this.getContributionsString(),
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_PercentageFunded(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.currentIteration.percentageFunded },
            note: this.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_percentageFundedEffective(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.currentIteration.percentageFundedEffective },
            note: this.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_PercentageFundedOverall(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.percentageFunded },
            note: this.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_PercentageFundedEffectiveOverall(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { numberValue: this.percentageFundedEffective },
            note: this.iterations.map(i => i.pointsRequiredToFund).join("\n"),
            userEnteredFormat: Object.assign({}, basicEntryFormat, <sheets_v4.Schema$CellFormat>{ numberFormat: { type: "NUMBER", pattern: "0.0%" } }),
        };
    }

    public getCell_DateFunded(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this.currentIteration.dateFunded!)}` },
            note: this.iterations.map(i => i.dateFunded?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }
    
    public getCell_DateSelected(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this.currentIteration.dateSelected!)}` },
            note: this.iterations.map(i => i.dateSelected?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_WaitTimeMultiplier(dateFundedCellOffset: number, dateSelectedCellOffset: number): sheets_v4.Schema$CellData {
        const waitTimeMultiplierFormula = this.currentIteration.isFunded
            ? getWaitTimeMultiplierFormulaForSpreadsheet(dateFundedCellOffset, dateSelectedCellOffset)
            : 1;
        return {
            userEnteredValue: { formulaValue: `=${waitTimeMultiplierFormula}` },
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_DateStarted(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this.currentIteration.dateStarted!)}` },
            note: this.iterations.map(i => i.dateStarted?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_DateCompleted(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this.currentIteration.dateCompleted!)}` },
            note: this.iterations.map(i => i.dateCompleted?.toISOString()).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_DateRequested(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { formulaValue: `=${getDatetimeFormulaForSpreadsheet(this.currentIteration.dateRequested)}` },
            note: this.iterations.map(i => `${i.dateRequested.toISOString()}`).join("\n"),
            userEnteredFormat: basicDateFormat,
        };
    }

    public getCell_RequestorName(): sheets_v4.Schema$CellData {
        return {
            userEnteredValue: { stringValue: this.currentIteration.requestorName, },
            note: this.iterations.map(i => `${i.requestorName} • ${i.requestorName}`).join("\n"),
            userEnteredFormat: basicEntryFormat,
        };
    }

    public getCell_BorderRight(): sheets_v4.Schema$CellData {
        return {
            userEnteredFormat: borderLeft,
        };
    }

    protected getHoursPlayedString(): string {
        return `${this.iterations.map(i => `${i.estimatedGameLengthHours} • ${i.hoursPlayed}`).join("\n")}`
    }

    protected getContributionsString(): string {
        return this.iterations.map(i =>
            i.contributions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).map(c =>
                `${c.timestamp} • ${c.points} • ${c.name} • ${c.id}`).join("\n")).join("\n\n");
    }

    protected parseUtcDates(datesString: string): Date[] {
        const dates = datesString.split("\n").map(n => Utils.getDateFromUtcTimestring(n));
        return dates;
    }
}

export class GameRequestEntryGoogleCompleted extends GameRequestEntryGoogle {
    public static headers: SpreadsheetRow[] =
        [
            ["Completed Requests"],
            ["Game Name", "Hours Played", "Points Contributed", "% Funded", "Date Funded", "Date Selected", "Wait Time Multiplier", "Date Started", "Date Completed", "Date Requested", "Requested By"],
        ];
    public static footers: sheets_v4.Schema$RowData = getBorderRowBelow(11);

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