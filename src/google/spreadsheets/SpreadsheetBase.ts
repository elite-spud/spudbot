import { sheets_v4 } from "googleapis";
import { borderLeft, headerFormatCenter } from "./GameRequestSpreadsheetStyle";
import { Utils } from "../../Utils";

export type SpreadsheetRow = (string | number | undefined)[];
export function headersToRowData(rows: SpreadsheetRow[]): sheets_v4.Schema$RowData[] {
    const rowDataArray = rows.map(row => {
        const rowData: sheets_v4.Schema$RowData = {
            values: row.map((n) => {
                const cellData: sheets_v4.Schema$CellData = {
                    userEnteredValue: { stringValue: n?.toString() },
                    userEnteredFormat: headerFormatCenter,
                }
                return cellData;
            }).concat({ userEnteredFormat: borderLeft }),
        };
        return rowData;
    });
    return rowDataArray;
}

export async function pushSpreadsheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetId: number, spreadsheet: SpreadsheetBase): Promise<void> {    
    await clearSheet(sheetsApi, sheetId, subSheetId);
    await updateSheet(sheetsApi, sheetId, subSheetId, spreadsheet.toRowData());
}

async function clearSheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetId: number): Promise<void> {
    const batchSheetClearRequest: sheets_v4.Schema$Request = {
        updateCells: {
            range: {
                sheetId: subSheetId,
                startColumnIndex: 0,
                startRowIndex: 0,
            },
            fields: "*",
        },
    };
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [batchSheetClearRequest] },
    });
}

async function updateSheet(sheetsApi: sheets_v4.Sheets, sheetId: string, subSheetId: number, rowData: sheets_v4.Schema$RowData[]) {
    const batchSheetUpdateRequest: sheets_v4.Schema$Request = {
        updateCells: {
            start: {
                sheetId: subSheetId,
            },
            rows: rowData,
            fields: "*",
        },
    };
    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [batchSheetUpdateRequest] },
    });
}

export abstract class SpreadsheetBase {
    public abstract toRowData(): sheets_v4.Schema$RowData[];
}

export abstract class SpreadsheetBlock {
    public abstract toRowData(): sheets_v4.Schema$RowData[];
}

export function getEntryValue_String(cell: sheets_v4.Schema$CellData): string | undefined {
    if (cell.userEnteredValue === undefined) {
        return undefined;
    }
    if (cell.userEnteredValue.stringValue !== undefined && cell.userEnteredValue.stringValue !== null) {
        return cell.userEnteredValue.stringValue;
    }
    if (cell.userEnteredValue.formulaValue !== undefined && cell.userEnteredValue.formulaValue !== null) {
        return cell.userEnteredValue.formulaValue;
    }
    throw new Error(`Cell value was expected to be string, but had no string values`);
}

export function getEntryValue_Number(cell: sheets_v4.Schema$CellData): number | undefined {
    if (cell.userEnteredValue === undefined) {
        return undefined;
    }
    if (cell.userEnteredValue.numberValue !== undefined && cell.userEnteredValue.numberValue !== null) {
        return cell.userEnteredValue.numberValue;
    }
    throw new Error(`Cell value was expected to be a number, but had no number values`);
}

export function getEntryValue_Boolean(cell: sheets_v4.Schema$CellData): boolean | undefined {
    if (cell.userEnteredValue === undefined) {
        return undefined;
    }
    if (cell.userEnteredValue.boolValue !== undefined && cell.userEnteredValue.boolValue !== null) {
        return cell.userEnteredValue.boolValue;
    }
    throw new Error(`Cell value was expected to be a boolean, but had no boolean values`);
}

export function getEntryValue_Date(cell: sheets_v4.Schema$CellData): Date | undefined {
    if (cell.userEnteredValue === undefined) {
        return undefined;
    }
    if (cell.formattedValue) {
        return Utils.getDateFromUtcTimestring(cell.formattedValue);
    }
    throw new Error(`Cell value was expected to be a valid Date, but had no formatted value`);
}

// TODO: return a generic header row type
export function parseHeaderFooterRow(row: sheets_v4.Schema$RowData): (string | undefined)[] {
    if (!row || !row.values) {
        throw new Error("Expected header/footer row to have values");
    }
    
    const array: (string | undefined)[] = [];
    let numEmptyCells = 0;
    for (const value of row.values) {
        const strValue = getEntryValue_String(value);
        if (strValue === undefined) {
            numEmptyCells++;
            continue;
        }
        for (let i = 0; i < numEmptyCells; i++) {
            array.push(undefined);
        }
        array.push(strValue);
    }
    return array;
}

export function extractBlockArray(sheet: sheets_v4. Schema$Sheet): sheets_v4.Schema$RowData[][] {
    const blockArray: sheets_v4.Schema$RowData[][] = [];
    let rows: sheets_v4.Schema$RowData[] = [];

    for (const gridData of sheet.data!) {
        for (const row of gridData.rowData!) {
            let rowHasData = false;
            if (row.values) {
                for (const value of row.values) {
                    if (value.userEnteredValue) {
                        rowHasData = true;
                        break;
                    }
                }
            }

            if (!rowHasData) { // empty row
                if (rows.length > 0) { // block is done
                    blockArray.push(rows);
                    rows = [];
                }
                continue;
            }

            rows.push(row);
        }
    }

    if (rows.length > 0) {
        blockArray.push(rows);
    }
    return blockArray;
}

export function getDateFormulaForSpreadsheet(date: Date): string {
    return `DATEVALUE(MID("${date.toISOString()}",1,10))`; // of the form 2012-11-04T14:51:06.157Z
}

export function getTimeFormulaForSpreadsheet(date: Date): string {
    return `TIMEVALUE(MID("${date.toISOString()}",12,8))`; // of the form 2012-11-04T14:51:06.157Z
}

export function getDatetimeFormulaForSpreadsheet(date: Date): string {
    const sheetFormula = `${getDateFormulaForSpreadsheet(date)} + ${getTimeFormulaForSpreadsheet(date)}`;
    return sheetFormula;
}

export function getTimestampStringForSpreadsheet(date: Date, includeTime: boolean = true): string {
    const timeStr = date.toISOString() // of the form 2012-11-04T14:51:06.157Z
        .replace(/T/, " ") // delete the T
        .substring(0, includeTime ? 16 : 10);
    return timeStr;
}

/** https://infoinspired.com/google-docs/spreadsheet/elapsed-days-and-time-between-two-dates-in-sheets/ */
export function getElapsedTimeFormulaForSpreadsheet(dateFundedCellOffset: number, includeTime: boolean = true): string {
    const dateDifferenceFormula = `NOW()-INDIRECT(ADDRESS(ROW(), COLUMN()+${dateFundedCellOffset}))`;
    const elapsedDaysFormula = `int(${dateDifferenceFormula})`;
    const elapsedHoursFormula = `text(${dateDifferenceFormula}-${elapsedDaysFormula},"HH")`;
    const formulaStr = includeTime
        ? `${elapsedDaysFormula}&" days "&${elapsedHoursFormula}&" hours"`
        : `${elapsedDaysFormula}&" days"`;
    return formulaStr;
}

export function getEffectivePointsFormulaForSpreadsheet(pointsContributedCellOffset: number, dateFundedCellOffset: number, dateStartedCellOffset?: number): string {
    const dateFundedReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${dateFundedCellOffset}))`;
    const dateStartedReferenceFormula = dateStartedCellOffset
        ? `INDIRECT(ADDRESS(ROW(), COLUMN()+${dateStartedCellOffset}))`
        : `NOW()`;
    const dateDifferenceFormula = `${dateStartedReferenceFormula}-(${dateFundedReferenceFormula})`;
    const elapsedYearsFormula = `int(${dateDifferenceFormula}) / 365`;
    const pointsContributedFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${pointsContributedCellOffset}))`;
    const effectivePointsFormula = `${pointsContributedFormula} * POW(2, ${elapsedYearsFormula})`;
    return effectivePointsFormula;
}

export function getPercentageFundedFormulaForSpreadsheet_NotStarted(pointsRequiredToFundCellOffset: number, effectivePointsCellOffset: number): string {
    const effectivePointsReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${effectivePointsCellOffset}))`;
    const pointsRequiredToFundReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${pointsRequiredToFundCellOffset}))`
    return `${effectivePointsReferenceFormula} / ${pointsRequiredToFundReferenceFormula}`;
}

export function getPercentageFundedFormulaForSpreadsheet_Started(pointsContributedCellOffset: number, dateFundedCellOffset: number, dateStartedCellOffset: number, pointsRequiredToFund: number,): string {
    const effectivePointsFormula = getEffectivePointsFormulaForSpreadsheet(pointsContributedCellOffset, dateFundedCellOffset, dateStartedCellOffset);
    return `${effectivePointsFormula} / ${pointsRequiredToFund}`;
}