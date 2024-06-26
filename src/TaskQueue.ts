import { Future } from "./Future";

export class TaskQueue {
    protected _tasks: (() => void)[] = [];

    public get isRunning() { return this._runningFuture !== undefined; }
    protected _runningFuture: Future<void> | undefined;

    public addTask(task: () => Promise<void>): void {
        this._tasks.push(task);
    }

    public async startQueue(): Promise<void> {
        if (this.isRunning) {
            return this._runningFuture;
        }

        this._runningFuture = new Future<void>;
        while (this._tasks.length > 0) {
            const task = this._tasks.shift();
            if (task === undefined) {
                return;
            }
            try {
                await task();
            } catch (err) {
                console.log(err); // TODO: pretty this up by passing the log function
            }
        }

        this._runningFuture.resolve();
        return;
    }
}