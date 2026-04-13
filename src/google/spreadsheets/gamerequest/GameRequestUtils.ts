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

export function getWaitTimeMultiplierFormulaForSpreadsheet(dateFundedCellOffset: number, dateSelectedCellOffset?: number): string {
    const dateFundedReferenceFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${dateFundedCellOffset}))`;
    const dateStartedReferenceFormula = dateSelectedCellOffset
        ? `INDIRECT(ADDRESS(ROW(), COLUMN()+${dateSelectedCellOffset}))`
        : `NOW()`;
    const dateDifferenceFormula = `${dateStartedReferenceFormula}-(${dateFundedReferenceFormula})`;
    const elapsedYearsFormula = `int(${dateDifferenceFormula}) / 365`;
    const waitTimeMultiplierFormula = `POW(2, ${elapsedYearsFormula})`; // This formula must match what's calculated in GameRequestEntry
    return waitTimeMultiplierFormula;
}

export function getEffectivePointsFormulaForSpreadsheet(pointsContributedCellOffset: number, dateFundedCellOffset: number, dateSelectedCellOffset?: number): string {
    const waitTimeMultiplierFormula = getWaitTimeMultiplierFormulaForSpreadsheet(dateFundedCellOffset, dateSelectedCellOffset);
    const pointsContributedFormula = `INDIRECT(ADDRESS(ROW(), COLUMN()+${pointsContributedCellOffset}))`;
    const effectivePointsFormula = `${pointsContributedFormula} * ${waitTimeMultiplierFormula}`;
    return effectivePointsFormula;
}
