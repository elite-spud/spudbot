import { Future } from "./Future";

export class TaskQueue {
    protected _tasks: (() => void)[] = [];

    protected _runningFuture: Future<void> | undefined;

    public addTask(task: () => Promise<void>): void {
        this._tasks.push(task);
    }

    public async startQueue(): Promise<void> {
        if (this._runningFuture) {
            return this._runningFuture;
        }

        this._runningFuture = new Future<void>;
        while (this._tasks.length > 0) {
            const task = this._tasks.shift();
            if (task === undefined) {
                break;
            }
            try {
                await task();
            } catch (err) {
                console.log(err); // TODO: pretty this up
            }
        }

        this._runningFuture.resolve();
        this._runningFuture = undefined;
        return;
    }
}