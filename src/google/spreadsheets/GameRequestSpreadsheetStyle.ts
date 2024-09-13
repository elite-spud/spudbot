import { sheets_v4 } from "googleapis";

export function getBorderRowAbove(numCells: number): sheets_v4.Schema$RowData {
    const cells: sheets_v4.Schema$CellData[] = [];
    for (let i = 0; i < numCells; i++) {
        cells.push({ userEnteredFormat: borderBottom });
    }
    return { values: cells };
};

export function getBorderRowBelow(numCells: number): sheets_v4.Schema$RowData {
    const cells: sheets_v4.Schema$CellData[] = [];
    for (let i = 0; i < numCells; i++) {
        cells.push({ userEnteredFormat: borderTop });
    }
    return { values: cells };
};

export const borderTop: sheets_v4.Schema$CellFormat = {
    borders: {
        top: { style: "SOLID_MEDIUM"},
    },
};

export const borderBottom: sheets_v4.Schema$CellFormat = {
    borders: {
        bottom: { style: "SOLID_MEDIUM"},
    },
};

export const borderBetweenVertical: sheets_v4.Schema$CellFormat = {
    borders: {
        top: { style: "SOLID_MEDIUM"},
        bottom: { style: "SOLID_MEDIUM"},
    },
};

export const borderLeft: sheets_v4.Schema$CellFormat = {
    borders: {
        left: { style: "SOLID_MEDIUM"},
    },
};

export const borderRight: sheets_v4.Schema$CellFormat = {
    borders: {
        right: { style: "SOLID_MEDIUM"},
    },
};

export const headerFormatCenter: sheets_v4.Schema$CellFormat = {
    textFormat: {
        bold: true,
        fontSize: 12,
    },
    backgroundColorStyle: { rgbColor: { red: 0.8, blue: 0.8, green: 0.8 } },
    borders: {
        top: { style: "SOLID_MEDIUM"},
        bottom: { style: "SOLID_MEDIUM"},
        left: { style: "SOLID"},
        right: { style: "SOLID"},
    },
    horizontalAlignment: "CENTER",
};

export const basicEntryFormat: sheets_v4.Schema$CellFormat = {
    backgroundColorStyle: { rgbColor: { red: 0.93, blue: 0.93, green: 0.93 } },
    borders: {
        top: { style: "SOLID" },
        bottom: { style: "SOLID" },
        left: { style: "SOLID" },
        right: { style: "SOLID" },
    },
    textFormat: {
        fontSize: 12,
    },
    numberFormat: {
        type: "NUMBER",
        pattern: "0",
    }
};

export const basicDateFormat: sheets_v4.Schema$CellFormat = {
    backgroundColorStyle: { rgbColor: { red: 0.93, blue: 0.93, green: 0.93 } },
    borders: {
        top: { style: "SOLID" },
        bottom: { style: "SOLID" },
        left: { style: "SOLID" },
        right: { style: "SOLID" },
    },
    textFormat: {
        fontSize: 12,
    },
    numberFormat: {
        type: "DATE",
        pattern: "yyyy-mm-dd",
    }
}