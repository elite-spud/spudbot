import { EntryAlreadyExistsError, GameRequestEntry } from "./GameRequestEntry";

export class EntryNotFoundError extends Error {
    constructor() {
        super();
    }
}

export class GameRequestController {
    protected readonly _entries: GameRequestEntry[];
    public get entries(): GameRequestEntry[] { return Array.from(this._entries); }
    protected readonly _allowOverfunding: boolean;

    public constructor(entries: GameRequestEntry[], allowOverfunding: boolean) {
        this._entries = entries;
        this._allowOverfunding = allowOverfunding;
    }

    public findEntry(gameName: string): GameRequestEntry | undefined {
        const entry = this._entries.find(n => n.gameName.toLowerCase() === gameName.toLowerCase());
        if (entry)
            return entry;

        return undefined;
    }

    public addPointsToEntry(username: string, userId: string, gameName: string, points: number, timestamp: Date): void {
        const entry = this.findEntry(gameName);
        if (entry === undefined) {
            throw new EntryNotFoundError();
        }

        entry.currentIteration.addPoints(username, userId, points, timestamp, this._allowOverfunding);
    }

    public addEntry(gameName: string, gameLengthHours: number, pointsRequiredToFund: number | undefined, userId: string, username: string, points: number, timestamp: Date): void {
        const existingEntry = this.findEntry(gameName);
        if (existingEntry !== undefined) {
            throw new EntryAlreadyExistsError(gameName);
        }
        const entry = new GameRequestEntry({
            gameName: gameName,
            iterations: [],
        });
        entry.addIteration(username, userId, gameLengthHours, timestamp, pointsRequiredToFund);
        entry.currentIteration.addPoints(username, userId, points, timestamp, this._allowOverfunding);
    }

    public selectEntry(gameName: string, timestamp: Date): void {
        const entry = this.findEntry(gameName);
        if (entry === undefined) {
            throw new EntryNotFoundError();
        }

        entry.currentIteration.selectIteration(timestamp);
    }

    public startEntry(gameName: string, timestamp: Date): void {
        const entry = this.findEntry(gameName);
        if (entry === undefined) {
            throw new EntryNotFoundError();
        }

        entry.currentIteration.startIteration(timestamp);
    }

    public completeEntry(gameName: string, timestamp: Date, hoursPlayed: number): void {
        const entry = this.findEntry(gameName);
        if (entry === undefined) {
            throw new EntryNotFoundError();
        }

        entry.currentIteration.completeIteration(timestamp, hoursPlayed);
    }

    public startNewIteration(gameName: string, gameLengthHours: number, pointsRequiredToFund: number | undefined, userId: string, username: string, points: number, timestamp: Date) {
        const entry = this.findEntry(gameName);
        if (entry === undefined) {
            throw new EntryNotFoundError();
        }

        entry.addIteration(username, userId, gameLengthHours, timestamp, pointsRequiredToFund);
        entry.currentIteration.addPoints(username, userId, points, timestamp, this._allowOverfunding);
    }
}