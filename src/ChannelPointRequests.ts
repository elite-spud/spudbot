export class ChannelPointRequests {
    protected static readonly stepSize = 1000;
    protected static readonly baseHours = 3;
    protected static readonly baseCost = 10000;
    protected static readonly rateOfChangeScaler = 0.9;

    private constructor() {}

    public static getGameRequestPrice(hoursToBeat: number) {
        if (hoursToBeat < this.baseHours)
            return this.baseCost;

        const calculatedCost = this.baseCost * Math.pow(hoursToBeat / this.baseHours, this.rateOfChangeScaler);
        const nearestStep = Math.round(calculatedCost / this.stepSize) * this.stepSize; // Use Math.ceil to always round up
        return nearestStep;
    }
}