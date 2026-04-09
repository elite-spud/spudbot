// Adapted from https://stackoverflow.com/questions/40356609/resolve-or-reject-promise-later-in-typescript
export class Future<T> implements PromiseLike<T> {
    private promise: Promise<T>;
    private resolveFunction?: (value: T | PromiseLike<T>) => void;
    private rejectFunction?: (reason?: any) => void;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolveFunction = resolve;
            this.rejectFunction = reject;
        });
    }

    public asPromise(): Promise<T> {
        return this.promise;
    }

    public then<TResult>(onfulfilled?: (value: T) => TResult | PromiseLike<TResult>, onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<TResult>;
    public then<TResult>(onfulfilled?: (value: T) => TResult | PromiseLike<TResult>, onrejected?: (reason: any) => void): Promise<TResult>;
    public then<TResult>(onfulfilled?: (value: T) => TResult | PromiseLike<TResult>, onrejected?: (reason: any) => any): Promise<TResult> {
        return this.promise.then(onfulfilled, onrejected);
    }

    public catch(onrejected?: (reason: any) => T | PromiseLike<T>): Promise<T>;
    public catch(onrejected?: (reason: any) => void): Promise<T>;
    public catch(onrejected?: (reason: any) => any): Promise<T> {
        return this.promise.catch(onrejected);
    }

    public resolve(value: T | PromiseLike<T>): void {
        if (this.resolveFunction === undefined) {
            return;
        }
        this.resolveFunction(value);
    }

    public reject(reason?: any): void {
        if (this.rejectFunction === undefined) {
            return;
        }
        this.rejectFunction(reason);
    }
}