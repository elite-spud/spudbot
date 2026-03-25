import { ChannelPointRequests } from "../../../ChannelPointRequests";

export enum GameRequestEntry_IterationPhase {
    Unfunded = 0,
    Funded = 1,
    Selected = 2,
    InProgress = 3,
    Completed = 4,
}

export class FundingLimitExceededError extends Error {
    constructor(
        public readonly current: number,
        public readonly incoming: number,
        public readonly limit: number,
    ) {
        super();
    }
}

export class PhaseDoesNotAllowFundingError extends Error {
    constructor(public readonly phase: GameRequestEntry_IterationPhase) {
        super();
    }
}

export class CurrentIterationNotCompletedError extends Error {
    constructor(public readonly currentPhase: GameRequestEntry_IterationPhase) {
        super();
    }
}

export class NoCurrentIterationError extends Error {
    constructor() {
        super();
    }
}

export interface GameRequestContribution {
    readonly name: string;
    readonly id: string;
    readonly points: number;
    readonly timestamp: Date;
}

export class GameRequestIteration {
    public readonly dateRequested: Date;
    public readonly requestorId: string;
    public readonly requestorName: string;
    public readonly estimatedGameLengthHours: number;
    public readonly contributions: GameRequestContribution[];
    /** overrides the calculated funding requirement if supplied */
    public readonly pointsRequiredToFundOverride?: number;
    protected _dateFunded?: Date;
    protected _dateSelected?: Date;
    protected _dateStarted?: Date;
    protected _dateCompleted?: Date;
    protected _hoursPlayed: number | undefined;

    public constructor(args: {
        dateRequested: Date;
        requestorId: string;
        requestorName: string;
        estimatedGameLengthHours: number;
        contributions: GameRequestContribution[];
        pointsRequiredToFundOverride?: number;
        dateFunded?: Date;
        dateSelected?: Date;
        dateStarted?: Date;
        dateCompleted?: Date;
        hoursPlayed?: number;
    }) {
        this.dateRequested = args.dateRequested;
        this.requestorId = args.requestorId;
        this.requestorName = args.requestorName;
        this.estimatedGameLengthHours = args.estimatedGameLengthHours;
        this.contributions = args.contributions;
        this.pointsRequiredToFundOverride = args.pointsRequiredToFundOverride;
        this._dateFunded = args.dateFunded;
        this._dateSelected = args.dateSelected;
        this._dateStarted = args.dateStarted;
        this._dateCompleted = args.dateCompleted;
        this._hoursPlayed = args.hoursPlayed;
    }

    public get dateFunded(): Date | undefined { return this._dateFunded; }
    public get dateSelected(): Date | undefined { return this._dateSelected; }
    public get dateStarted(): Date | undefined { return this._dateStarted; }
    public get dateCompleted(): Date | undefined { return this._dateCompleted; }
    public get hoursPlayed(): number | undefined { return this._hoursPlayed; }

    public get phase(): GameRequestEntry_IterationPhase {
        if (this.dateCompleted !== undefined) {
            return GameRequestEntry_IterationPhase.Completed;
        }
        if (this.dateStarted !== undefined) {
            return GameRequestEntry_IterationPhase.InProgress;
        }
        if (this.dateSelected !== undefined) {
            return GameRequestEntry_IterationPhase.Selected;
        }
        if (this.dateFunded !== undefined && this.pointsContributed >= this.pointsRequiredToFund) {
            return GameRequestEntry_IterationPhase.Funded;
        }
        return GameRequestEntry_IterationPhase.Unfunded;
    }

    public get pointsRequiredToFund(): number {
        return this.pointsRequiredToFundOverride ?? ChannelPointRequests.getGameRequestPrice(this.estimatedGameLengthHours);
    }

    public get pointsContributed(): number {
        return this.contributions.reduce<number>((prev, current, _index) => {
            return prev + current.points;
        }, 0);
    }

    public get isFunded(): boolean {
        return this.phase >= GameRequestEntry_IterationPhase.Funded;
    }

    public get isSelected(): boolean {
        return this.phase >= GameRequestEntry_IterationPhase.Selected;
    }

    public get isStarted(): boolean {
        return this.phase >= GameRequestEntry_IterationPhase.InProgress;
    }

    public get isCompleted(): boolean {
        return this.phase >= GameRequestEntry_IterationPhase.Completed;
    }

    public get waitTimeMultiplier(): number {
        if (this.phase <= GameRequestEntry_IterationPhase.Unfunded) {
            return 1;
        }

        const oneYearMilliseconds = (1000 * 60 * 60 * 24 * 365);
        if (this.phase <= GameRequestEntry_IterationPhase.Funded && this.dateFunded !== undefined) {
            const elapsedMilliseconds = Date.now() - this.dateFunded.getTime();
            const elapsedYears = elapsedMilliseconds / oneYearMilliseconds;
            return Math.pow(2, elapsedYears);
        }

        if (this.phase <= GameRequestEntry_IterationPhase.Completed && this.dateFunded !== undefined && this.dateSelected !== undefined) {
            const elapsedMilliseconds = this.dateSelected.getTime() - this.dateFunded.getTime();
            const elapsedYears = elapsedMilliseconds / oneYearMilliseconds;
            return Math.pow(2, elapsedYears);
        }

        throw new Error(`Unable to calculate wait time multiplier.`);
    }

    public get effectivePoints(): number {
        return this.pointsContributed * this.waitTimeMultiplier;
    }

    public get percentageFunded(): number {
        return this.pointsContributed / this.pointsRequiredToFund;
    }

    public get percentageFundedEffective(): number {
        return this.effectivePoints / this.pointsRequiredToFund;
    }

    public addPoints(username: string, userId: string, points: number, timestamp: Date, allowOverfunding: boolean) {
        const fundingCutoffPhase = allowOverfunding
            ? GameRequestEntry_IterationPhase.Selected
            : GameRequestEntry_IterationPhase.Funded;
        if (this.phase >= fundingCutoffPhase) {
            throw new PhaseDoesNotAllowFundingError(this.phase);
        }

        const contributionWouldOverfund = this.pointsContributed + points > this.pointsRequiredToFund
        if (!allowOverfunding && contributionWouldOverfund) {
            throw new FundingLimitExceededError(this.pointsContributed, points, this.pointsRequiredToFund);
        }

        const contribution = { name: username, id: userId, points: points, timestamp: timestamp };
        this.contributions.push(contribution);
        if (this.isFunded) {
            this._dateFunded = timestamp;
        }

        return;
    }

    public selectIteration(timestamp: Date) {
        this._dateSelected = timestamp;
    }

    public startIteration(timestamp: Date) {
        this._dateStarted = timestamp;
    }

    public completeIteration(timestamp: Date, hoursPlayed: number) {
        this._dateCompleted = timestamp;
        this._hoursPlayed = hoursPlayed
    }
}

export class GameRequestEntry {
    public readonly gameName: string;
    public readonly iterations: GameRequestIteration[];

    public constructor(
            args: {
                gameName: string,
                iterations: GameRequestIteration[],
            }) {
        this.gameName = args.gameName;
        this.iterations = args.iterations;
    }

    public get pointsContributed(): number {
        return this.iterations.reduce<number>((prev, curr, _index) => { return prev + curr.pointsContributed }, 0);
    }

    public get pointsRequiredToFund(): number {
        return this.iterations.reduce<number>((prev, curr, _index) => { return prev + curr.pointsRequiredToFund }, 0);
    }

    public get effectivePoints(): number {
        return this.iterations.reduce<number>((prev, curr, _index) => { return prev + curr.effectivePoints }, 0);
    }

    public get percentageFunded(): number {
        return this.pointsContributed / this.pointsRequiredToFund;
    }
    
    public get percentageFundedEffective(): number {
        return this.effectivePoints / this.pointsRequiredToFund;
    }

    public get firstIteration(): GameRequestIteration {
        if (this.iterations.length === 0) {
            throw new NoCurrentIterationError();
        }
        const iteration = this.iterations[0];
        return iteration;
    }

    public get currentIteration(): GameRequestIteration {
        if (this.iterations.length === 0) {
            throw new NoCurrentIterationError();
        }
        const iteration = this.iterations[this.iterations.length - 1];
        return iteration;
    }

    public get hoursPlayed(): number {
        return this.iterations.reduce<number>((prev, curr, _index) => { return prev + (curr.hoursPlayed ?? 0) }, 0);
    }

    public addIteration(username: string, userId: string, estimatedGameLengthHours: number, timestamp: Date, pointsRequiredToFundOverride?: number): void {
        try {
            if (this.currentIteration.phase !== GameRequestEntry_IterationPhase.Completed) {
                throw new CurrentIterationNotCompletedError(this.currentIteration.phase);
            }
        } catch (err) {
            if (err instanceof NoCurrentIterationError) {
            } else {
                throw err;
            }
        }

        const iteration = new GameRequestIteration({
            dateRequested: timestamp,
            requestorId: userId,
            requestorName: username,
            estimatedGameLengthHours: estimatedGameLengthHours,
            contributions: [],
            pointsRequiredToFundOverride: pointsRequiredToFundOverride,
        });
        this.iterations.push(iteration);
    }
}