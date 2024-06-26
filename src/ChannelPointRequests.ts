export class ChannelPointRequests {
    protected static readonly baseHours = 3;
    protected static readonly baseCost = 10000;
    protected static readonly rateOfChangeScaler = 0.8;

    private constructor() {}

    public static getGameRequestPrice(hoursToBeat: number) {
        if (hoursToBeat < this.baseHours)
            return this.baseCost;

        const calculatedCost = this.baseCost * Math.pow(hoursToBeat / this.baseHours, this.rateOfChangeScaler);
        const nearestThousand = Math.round(calculatedCost / 1000) * 1000;
        return nearestThousand;
    }
}