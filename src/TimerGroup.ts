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

export class TimerGroup {
    protected _intervalId?: NodeJS.Timeout;

    public constructor(
        protected _commands: (IMessageHandler_AcceptsNoInput)[],
        protected readonly _intervalMinutes: number,
        protected readonly _startDelayMinutes: number = 0,
        protected readonly _randomizeCommands: boolean = false) {
    }

    public startTimer(): void {
        if (this._commands.length === 0) {
            return;
        }
        
        let currentIndex = 0;
        let intervalCommands = this._commands;
        if (this._randomizeCommands) {
            const orderedCommands = this._commands;
            const shuffledCommands: IMessageHandler_AcceptsNoInput[] = [];
            while (orderedCommands.length > 0) {
                const index = randomInt(orderedCommands.length);
                shuffledCommands.push(orderedCommands[index]!);
                orderedCommands.splice(index, 1);
            }
            intervalCommands = shuffledCommands;
        }
        
        const offsetMillis = this._startDelayMinutes * 60 * 1000;
        setTimeout(() => {
            const intervalMillis = this._intervalMinutes * 60 * 1000;

            const callNextCommand = () => {
                currentIndex = currentIndex === intervalCommands.length - 1
                    ? 0
                    : currentIndex + 1;
                const command = intervalCommands[currentIndex]!;
                const commandPromise = command.handleMessageWithoutInput(undefined, new Date(), false); // TODO: Don't send timer messages if stream isn't live / better yet, don't start the timers *until* the stream is live

                commandPromise.then((result) => {
                    if (result > HandleMessageResult.HandledSuccessfully) {
                        callNextCommand();
                    }
                })
                commandPromise.catch((_err) => {
                    callNextCommand();
                });
            };

            callNextCommand();
            this._intervalId = setInterval(callNextCommand, intervalMillis);
        }, offsetMillis);
    }

    public stopTimer(): void {
        if (this._intervalId) {
            clearInterval(this._intervalId);
        }
    }
}