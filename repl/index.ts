import { scan } from "../scanner/index.js";

export class ReplExecutionResult<TCommand = unknown> {
  constructor(
    readonly command?: TCommand,
    readonly output?: string
  ) {}
}

export interface ReplCallbacks<TCommand = unknown> {
  execute(source: string): Promise<ReplExecutionResult<TCommand>> | ReplExecutionResult<TCommand>;
  needsContinuation?(input: string): boolean;
}

export class ReplResult<TCommand = unknown> extends ReplExecutionResult<TCommand> {
  constructor(
    readonly pending: boolean,
    command?: TCommand,
    output?: string
  ) {
    super(command, output);
  }
}

export class ReplEngine<TCommand = unknown> {
  private pendingInput = "";
  private readonly history: string[] = [];
  private historyIndex: number | null = null;
  private historyDraft = "";

  constructor(private readonly callbacks: ReplCallbacks<TCommand>) {
    if (!callbacks || typeof callbacks.execute !== "function") {
      throw new Error("ReplEngine requires callbacks with an execute(source) function");
    }
  }

  getHistory(): readonly string[] {
    return this.history;
  }

  getContinuationLevel(): number {
    if (this.pendingInput.length === 0) {
      return 0;
    }

    const bracketBalance = getBracketBalance(this.pendingInput);
    return bracketBalance > 0 ? bracketBalance : 1;
  }

  navigateHistory(direction: "up" | "down", currentInput: string): string {
    if (this.history.length === 0) {
      return currentInput;
    }

    if (direction === "up") {
      if (this.historyIndex === null) {
        this.historyDraft = currentInput;
        this.historyIndex = this.history.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex -= 1;
      }

      return this.history[this.historyIndex] ?? currentInput;
    }

    if (this.historyIndex === null) {
      return currentInput;
    }

    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      return this.history[this.historyIndex] ?? currentInput;
    }

    this.historyIndex = null;
    return this.historyDraft;
  }

  resetHistoryNavigation(): void {
    this.historyIndex = null;
    this.historyDraft = "";
  }

  async evaluate(line: string): Promise<ReplResult<TCommand>> {
    this.resetHistoryNavigation();
    this.pendingInput = this.pendingInput.length > 0 ? `${this.pendingInput}\n${line}` : line;

    const continuationChecker = this.callbacks.needsContinuation ?? needsContinuation;
    if (continuationChecker(this.pendingInput)) {
      return new ReplResult<TCommand>(true);
    }

    const source = this.pendingInput;
    this.pendingInput = "";

    this.history.push(source);

    const result = await this.callbacks.execute(source);

    return new ReplResult(false, result.command, result.output);
  }
}

function needsContinuation(input: string): boolean {
  const lines = input.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  if (lastLine.endsWith("\\")) {
    return true;
  }

  const bracketBalance = getBracketBalance(input);

  return bracketBalance > 0;
}

function getBracketBalance(input: string): number {
  const tokens = scan(input);
  let bracketBalance = 0;

  for (const token of tokens) {
    if (token.type !== "delimiter") continue;
    if (token.value === "(" || token.value === "[" || token.value === "{") bracketBalance += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") bracketBalance -= 1;
  }

  return bracketBalance;
}
