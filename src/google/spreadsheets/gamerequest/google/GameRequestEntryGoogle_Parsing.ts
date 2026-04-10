import { sheets_v4 } from "googleapis";
import { GameRequestContribution, GameRequestEntry, GameRequestIteration } from "../GameRequestEntry";
import { Utils } from "../../../../Utils";
import { getEntryValue_String } from "../../SpreadsheetBase";

export function parseGameRequestEntry(row: sheets_v4.Schema$RowData): GameRequestEntry {
    if (!row.values) {
        throw new Error("Expected entry row to have values");
    }

    const gameName = getEntryValue_String(row.values[0]);
    if (gameName === undefined) {
        throw new Error("Unable to parse game request entry: Game name must be defined");
    }

    const iterations = buildIterations({
        hoursPlayedByIteration: parseFromNote_HoursPlayedByIteration(row.values[1]),
        pointsContributedByIteration: parseFromNote_PointContributionsByIteration(row.values[2]),
        pointsRequiredByIteration: parsefromNote_NumberByIteration(row.values[3]),
        datesFundedByIteration: parseFromNote_DateByIteration(row.values[4]),
        datesSelectedByIteration: parseFromNote_DateByIteration(row.values[5]),
        datesStartedByIteration: parseFromNote_DateByIteration(row.values[7]),
        datesCompletedByIteration: parseFromNote_DateByIteration(row.values[8]),
        dateRequestedByIteration: parseFromNote_DateByIteration(row.values[9]),
        requestedByByIteration: parseFromNote_RequestorByIteration(row.values[10]),
    });

    return new GameRequestEntry({
        gameName: gameName,
        iterations: iterations,
    });
}

interface IterationBuildArgs {
    hoursPlayedByIteration: HoursPlayedIteration[];
    pointsContributedByIteration: GameRequestContribution[][];
    pointsRequiredByIteration: number[];
    datesFundedByIteration: Date[];
    datesSelectedByIteration: Date[];
    datesStartedByIteration: Date[];
    datesCompletedByIteration: Date[];
    dateRequestedByIteration: Date[];
    requestedByByIteration: RequestorIteration[];
}

function buildIterations(args: IterationBuildArgs): GameRequestIteration[] {
    const numIterations = args.requestedByByIteration.length;
    const iterations: GameRequestIteration[] = [];
    const lengthsNotIdentical = [
        args.hoursPlayedByIteration.length, args.pointsContributedByIteration.length, args.pointsRequiredByIteration.length, args.datesFundedByIteration.length,
        args.datesSelectedByIteration.length, args.datesStartedByIteration.length, args.datesCompletedByIteration.length, args.dateRequestedByIteration.length,
    ].some(n => n !== numIterations);
    if (lengthsNotIdentical) {
        throw new Error(`Unable to create new Game Request Iteration: iteration arrays must all be of same length (expected ${numIterations})`);
    }

    for (let i = 0; i < numIterations; i++) {
        const foo = args.dateRequestedByIteration[i];
        const iteration = new GameRequestIteration({
            dateRequested: foo,
            requestorId: args.requestedByByIteration[i].requestorId,
            requestorName: args.requestedByByIteration[i].requestorName,
            estimatedGameLengthHours: args.hoursPlayedByIteration[i].hoursEstimated,
            contributions: args.pointsContributedByIteration[i],
            pointsRequiredToFundOverride: args.pointsRequiredByIteration[i],
            dateFunded: args.datesFundedByIteration[i],
            dateSelected: args.datesSelectedByIteration[i],
            dateStarted: args.datesStartedByIteration[i],
            dateCompleted: args.datesCompletedByIteration[i],
            hoursPlayed: args.hoursPlayedByIteration[i].hoursPlayed,
        });

        iterations.push(iteration);
    }

    return iterations;
}

export interface IParseIterationArgs<T> {
    cell: sheets_v4.Schema$CellData;
    /** defaults to \s*•\s* if undefined */
    iterationPattern?: RegExp;
    numValuesPerLine: number;
    toGeneric: (values: string[]) => T;
}

function parseValueByIterationFromNote<T>(args: IParseIterationArgs<T>): T[] {
    const valuesByIteration = parseValuesByIterationFromNote(args);
    const returnValues: T[] = [];
    for (const values of valuesByIteration) {
        if (values.length !== 1) {
            throw new Error("Expected only one value per iteration");
        }
        returnValues.push(values[0]);
    }

    return returnValues;
}

function parseValuesByIterationFromNote<T>(args: IParseIterationArgs<T>): T[][] {
    if (args.cell.note === undefined || args.cell.note === null) {
        throw new Error("Note must be defined to parse points contributed");
    }
    const iterationStrings = args.cell.note.split("\n\n");
    const iterations: T[][] = [];
    for (const iterationString of iterationStrings) {
        const entryStrings = iterationString.split("\n");
        const entries: T[] = [];
        for (const valueString of entryStrings) {
            const tokens = valueString.split(args.iterationPattern ?? /\s*•\s*/);
            const expectedTokens = args.numValuesPerLine;
            if (tokens.length !== expectedTokens) {
                throw new Error(`Unable to parse iteration string: Did not receive expected number of tokens from regex (found ${tokens.length}, expected ${expectedTokens}`);
            }
            const value = args.toGeneric(tokens);
            entries.push(value);
        }
        iterations.push(entries);
    }
    return iterations;
}

interface HoursPlayedIteration {
    hoursPlayed: number;
    hoursEstimated: number;
}
export function parseFromNote_HoursPlayedByIteration(cell: sheets_v4.Schema$CellData): HoursPlayedIteration[] {
    const func = (strings: string[]): HoursPlayedIteration => {
        return {
            hoursPlayed: Number.parseInt(strings[0]),
            hoursEstimated: Number.parseInt(strings[1]),
        };
    }
    const args: IParseIterationArgs<HoursPlayedIteration> = {
        cell: cell,
        numValuesPerLine: 2,
        toGeneric: func,
    };
    return parseValueByIterationFromNote(args);
}

export function parseFromNote_PointContributionsByIteration(cell: sheets_v4.Schema$CellData): GameRequestContribution[][] {
    const func = (strings: string[]): GameRequestContribution => {
        return {
            name: strings[2],
            id: strings[3],
            points: Number.parseInt(strings[1]),
            timestamp: Utils.getDateFromUtcTimestring(strings[0]),
        }
    }
    const args: IParseIterationArgs<GameRequestContribution> = {
        cell: cell,
        numValuesPerLine: 2,
        toGeneric: func,
    };
    return parseValuesByIterationFromNote(args);
}

interface RequestorIteration {
    requestorId: string;
    requestorName: string;
}
export function parseFromNote_RequestorByIteration(cell: sheets_v4.Schema$CellData): RequestorIteration[] {
    const func = (strings: string[]): RequestorIteration => {
        return {
            requestorId: strings[1],
            requestorName: strings[0],
        };
    }
    const args: IParseIterationArgs<RequestorIteration> = {
        cell: cell,
        numValuesPerLine: 2,
        toGeneric: func,
    };
    return parseValueByIterationFromNote(args);
}

export function parsefromNote_NumberByIteration(cell: sheets_v4.Schema$CellData): number[] {
    const func = (strings: string[]): number => {
        return Number.parseInt(strings[0]);
    }
    const args: IParseIterationArgs<number> = {
        cell: cell,
        numValuesPerLine: 1,
        toGeneric: func,
    };
    return parseValueByIterationFromNote(args);
}

export function parseFromNote_DateByIteration(cell: sheets_v4.Schema$CellData): Date[] {
    const func = (strings: string[]): Date => {
        return Utils.getDateFromUtcTimestring(strings[0]);
    }
    const args: IParseIterationArgs<Date> = {
        cell: cell,
        numValuesPerLine: 1,
        toGeneric: func,
    };
    return parseValueByIterationFromNote(args);
}

export function parseFromNote_StringByIteration(cell: sheets_v4.Schema$CellData): string[] {
    const func = (strings: string[]): string => {
        return strings[0];
    }
    const args: IParseIterationArgs<string> = {
        cell: cell,
        numValuesPerLine: 1,
        toGeneric: func,
    };
    return parseValueByIterationFromNote(args);
}
