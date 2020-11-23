import { randomInt } from "crypto";

export class Utils {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private constructor() {
    }

    public static pickOne<T>(arr: T[]): T {
        const roll = randomInt(arr.length);
        return arr[roll];
    }
}