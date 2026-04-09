import { Future } from "./Future";

export class PendingTaskGroup {
    protected _lastHeldTaskDict: { [key: string]: PendingTask } = {};

    public async setPendingTask(key: string, task: PendingTask, timeoutMillis?: number): Promise<void> {
        await this.cancel(key);
        this._lastHeldTaskDict[key] = task;
        if (timeoutMillis) {
            setTimeout(async () => {
                const existingTask = this._lastHeldTaskDict[key];
                if (existingTask !== undefined && existingTask.id === task.id) {
                    await this.cancel(key);
                }
            }, timeoutMillis);
        }
    }

    public async complete(key: string): Promise<boolean | undefined> {
        const existingTask = this._lastHeldTaskDict[key];
        if (existingTask !== undefined) {
            return existingTask.complete();
        }
        return undefined;
    }

    public async cancel(key: string): Promise<boolean | undefined> {
        const existingTask = this._lastHeldTaskDict[key];
        if (existingTask !== undefined) {
            return existingTask.cancel();
        }
        return undefined;
    }
}

// TODO: have this implement PromiseLike somehow
export class PendingTask {
    protected _hasBeenTriggered = false;
    protected readonly _future = new Future<boolean>();
    public readonly id: string = crypto.randomUUID();
    public get promise(): Promise<boolean> {
        return this._future.asPromise();
    }

    public constructor(protected readonly _complete: () => Promise<void>, protected readonly _cancel: () => Promise<void>) {
    }

    public async complete(): Promise<boolean> {
        if (this._hasBeenTriggered) {
            return this.promise;
        } else {
            this._hasBeenTriggered = true;
        }
        await this._complete();
        this._future.resolve(true);
        return this.promise;
    }

    public async cancel(): Promise<boolean> {
        if (this._hasBeenTriggered) {
            return this.promise;
        } else {
            this._hasBeenTriggered = true;
        }
        await this._cancel();
        this._future.resolve(false);
        return this.promise;
    }
}