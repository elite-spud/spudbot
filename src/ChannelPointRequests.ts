import { TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd } from "./TwitchBotTypes";

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

    public static async handleChannelPointGameRequest(event: TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd): Promise<void> {
        const gameName = event.user_input;
        const gameHasBeenSuggestedBefore = await this.checkIfGameHasAlreadyBeenSuggested(gameName);

        if (!gameHasBeenSuggestedBefore) {
            // TODO, don't do anything, let the streamer manually approve this, but send a chat message to inform the chatter that it's on hold
            return;
        }
        
        this.addChannelPointsToGameSuggestion(gameName, event.reward.cost);
    }

    public static async checkIfGameHasAlreadyBeenSuggested(_gameName: string): Promise<boolean> {
        // TODO: implement this against Google Sheets
        return false;
    }

    public static async addChannelPointsToGameSuggestion(_gameName: string, _amount: number): Promise<void> {
        // TODO: implement this
        return;
    }
}