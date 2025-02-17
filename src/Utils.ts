import { randomInt } from "crypto";

export type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
export type XOR<T, U> = (T | U) extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U;

export class Utils {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private constructor() {
    }

    public static pickOne<T>(arr: T[]): T {
        const roll = randomInt(arr.length);
        return arr[roll];
    }

    public static getDateFromUtcTimestring(dateString: string): Date {
        const localTimezoneAssumedDate = new Date(dateString);
        const getTimezoneOffsetMillis = localTimezoneAssumedDate.getTimezoneOffset() * 60 * 1000;
        const utcAdjustedTime = localTimezoneAssumedDate.getTime() - getTimezoneOffsetMillis;
        const utcDate = new Date(utcAdjustedTime);
        return utcDate;
    }
}