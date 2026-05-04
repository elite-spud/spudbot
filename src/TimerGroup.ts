import { randomInt } from "crypto";
import { clearInterval } from "timers";
import { HandleMessageResult, IMessageHandler_AcceptsNoInput } from "./ChatCommand";

export class TimerCommand implements IMessageHandler_AcceptsNoInput {
    protected readonly _command: IMessageHandler_AcceptsNoInput;
    
    public constructor(command: IMessageHandler_AcceptsNoInput) {
        this._command = command;
    }

    handleMessageWithoutInput(userId: string | undefined, timestamp: Date): Promise<HandleMessageResult> {
        return this._command.handleMessageWithoutInput(userId, timestamp, false);
    }
}

export interface TimerGroupArgs {
    commands: (IMessageHandler_AcceptsNoInput)[];
    intervalMinutes: number;
    startDelayMinutes?: number;
    randomizeCommands?: boolean;
}

export class TimerGroup {
    protected readonly _commands: IMessageHandler_AcceptsNoInput[];
    protected readonly _intervalMinutes: number;
    protected readonly _startDelayMinutes: number;
    
    protected _intervalId?: NodeJS.Timeout;
    protected _nextCommandIndex: number = 0;

    public constructor(args: TimerGroupArgs) {
        this._commands = Array.from(args.commands);
        if (!!args.randomizeCommands) {
            const orderedCommands = Array.from(this._commands);
            const shuffledCommands: IMessageHandler_AcceptsNoInput[] = [];
            while (orderedCommands.length > 0) {
                const index = randomInt(orderedCommands.length);
                shuffledCommands.push(orderedCommands[index]!);
                orderedCommands.splice(index, 1);
            }
            this._commands = shuffledCommands;
        }

        this._intervalMinutes = args.intervalMinutes;
        this._startDelayMinutes = args.startDelayMinutes ?? 0;
    }

    protected async callNextCommand(): Promise<HandleMessageResult> {
        const startIndex = this._nextCommandIndex;
        do {
            const command = this._commands[this._nextCommandIndex];
            const commandPromise = command.handleMessageWithoutInput(undefined, new Date(), false);

            this._nextCommandIndex = this._nextCommandIndex === this._commands.length - 1
                ? 0
                : this._nextCommandIndex + 1;
            
            const result = await commandPromise;
            if (result === HandleMessageResult.HandledSuccessfully) {
                return result;
            }
        } while (this._nextCommandIndex !== startIndex)
        
        return HandleMessageResult.MiscNotHandled;
    }

    public startTimer(): void {
        if (this._commands.length === 0) {
            return;
        }
        
        const offsetMillis = this._startDelayMinutes * 60 * 1000;
        setTimeout(() => {
            const intervalMillis = this._intervalMinutes * 60 * 1000;

            const func = async () => {
                try {
                    await this.callNextCommand();
                } catch (err) {
                    console.log(`Unable to call next command in TimerGroup`);
                    console.log(err);
                }
            }

            this._intervalId = setInterval(func, intervalMillis);
        }, offsetMillis);
    }

    public stopTimer(): void {
        if (this._intervalId) {
            clearInterval(this._intervalId);
        }
    }
}