import { randomInt } from "crypto";

export type ChanceTimeTuple<T> = { weight: number, value: T };

export class ChanceTime<T> {
    protected _totalWeight = 0;
    protected _tuples: { value: T, triggerLow: number, triggerHigh: number }[] = []

    public constructor(tuples: ChanceTimeTuple<T>[]) {
        for (const tuple of tuples) {
            this.add(tuple.weight, tuple.value);
        }
    }

    public add(weight: number, value: T): void {
        const integerWeight = Math.trunc(weight);
        if (integerWeight < 1) {
            return;
        }
        const tuple = { value, triggerLow: this._totalWeight, triggerHigh: this._totalWeight + weight - 1 };
        this._totalWeight += weight;
        this._tuples.push(tuple);
    }

    public roll(): T {
        const roll = randomInt(this._totalWeight);
        for (const tuple of this._tuples) { // TODO: binary search instead
            if (roll <= tuple.triggerHigh && roll >= tuple.triggerLow) {
                return tuple.value;
            }
        }

        throw new Error("Unable to find a match when rolling weighted keys! (this should never happen)");
    }
}