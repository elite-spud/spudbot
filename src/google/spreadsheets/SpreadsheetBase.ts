import { sheets_v4 } from "googleapis";
import { borderLeft, headerFormatCenter } from "./GameRequestSpreadsheetStyle";

export type SpreadsheetRow = (string | number | undefined)[];
export function headerToRowData(row: SpreadsheetRow): sheets_v4.Schema$RowData {
    return {
        values: row.map((n) => {
            const cellData: sheets_v4.Schema$CellData = {
                userEnteredValue: { stringValue: n?.toString() },
                userEnteredFormat: headerFormatCenter,
            }
            return cellData;
        }).concat({ userEnteredFormat: borderLeft }),
    };
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

export function getEntryValue_String(cell: sheets_v4.Schema$CellData): string {
    if (cell.userEnteredValue === undefined) {
        throw new Error("Expected value to not be undefined");
    }
    if (cell.userEnteredValue.stringValue !== undefined && cell.userEnteredValue.stringValue !== null) {
        return cell.userEnteredValue.stringValue;
    }
    if (cell.userEnteredValue.formulaValue !== undefined && cell.userEnteredValue.formulaValue !== null) {
        return cell.userEnteredValue.formulaValue;
    }
    throw new Error(`Cell value was expected to be string, but had no string values`);
}

export function getEntryValue_Number(cell: sheets_v4.Schema$CellData): number {
    if (cell.userEnteredValue === undefined) {
        throw new Error("Expected value to not be undefined");
    }
    if (cell.userEnteredValue.numberValue !== undefined && cell.userEnteredValue.numberValue !== null) {
        return cell.userEnteredValue.numberValue;
    }
    throw new Error(`Cell value was expected to be a number, but had no number values`);
}

export function getEntryValue_Boolean(cell: sheets_v4.Schema$CellData): boolean {
    if (cell.userEnteredValue === undefined) {
        throw new Error("Expected value to not be undefined");
    }
    if (cell.userEnteredValue.boolValue !== undefined && cell.userEnteredValue.boolValue !== null) {
        return cell.userEnteredValue.boolValue;
    }
    throw new Error(`Cell value was expected to be a boolean, but had no boolean values`);
}

export function getEntryValue_Date(cell: sheets_v4.Schema$CellData): Date {
    if (cell.userEnteredValue === undefined) {
        throw new Error("Expected value to not be undefined");
    }
    if (cell.formattedValue) {
        return new Date(cell.formattedValue);
    }
    throw new Error(`Cell value was expected to be a valid Date, but had no formatted value`);
}

// TODO: return a generic header row type
export function parseHeaderFooterRow(row: sheets_v4.Schema$RowData): (string | undefined)[] {
    if (!row || !row.values) {
        throw new Error("Expected header/footer row to have values");
    }
    
    const array: (string | undefined)[] = [];
    for (const value of row.values) {
        try {
            const strValue = getEntryValue_String(value);
            array.push(strValue);
        } catch {
            array.push(undefined);
        }
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

export function formatTimestampForSpreadsheet(date: Date, excludeTime: boolean = false): string {
    const timeStr = date.toISOString() // of the form 2012-11-04T14:51:06.157Z
        .replace(/T/, " ") // delete the T
        .substring(0, excludeTime ? 10 : 16);
    return timeStr;
}