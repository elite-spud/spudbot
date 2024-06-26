import { sheets_v4 } from "googleapis";

export type SpreadsheetRow = (string | number | undefined)[];

export abstract class SpreadsheetBlock {
    public abstract toGridData(): SpreadsheetRow[];
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

export function  getEntryValue_Number(cell: sheets_v4.Schema$CellData): number {
    if (cell.userEnteredValue === undefined) {
        throw new Error("Expected value to not be undefined");
    }
    if (cell.userEnteredValue.numberValue !== undefined && cell.userEnteredValue.numberValue !== null) {
        return cell.userEnteredValue.numberValue;
    }
    throw new Error(`Cell value was expected to be a number, but had no number values`);
}

export function  getEntryValue_Boolean(cell: sheets_v4.Schema$CellData): boolean {
    if (cell.userEnteredValue === undefined) {
        throw new Error("Expected value to not be undefined");
    }
    if (cell.userEnteredValue.boolValue !== undefined && cell.userEnteredValue.boolValue !== null) {
        return cell.userEnteredValue.boolValue;
    }
    throw new Error(`Cell value was expected to be a boolean, but had no boolean values`);
}

// TODO: return a generic header row type
export function parseHeaderFooterRow(row: sheets_v4.Schema$RowData): (string | undefined)[] {
    if (!row.values) {
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
    for (const gridData of sheet.data!) {
        let gridHasData = false;
        let rowArray: sheets_v4.Schema$RowData[] = [];
        for (const row of gridData.rowData!) {
            let rowHasData = false;
            if (row.values) {
                for (const value of row.values) {
                    if (value.userEnteredValue) {
                        rowHasData = true;
                        gridHasData = true;
                        break;
                    }
                }
            }

            if (rowHasData) {
                rowArray.push(row);
            } else {
                blockArray.push(rowArray);
                rowArray = [];
            }
        }

        if (gridHasData) {
            blockArray.push(rowArray);
        }
    }

    return blockArray;
}