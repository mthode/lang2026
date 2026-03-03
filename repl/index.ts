import { scan } from "../scanner/index.js";

export interface ReplExecutionResult<TCommand = unknown> {
  command?: TCommand;
  output?: string;
}

export interface ReplCallbacks<TCommand = unknown> {
  execute(source: string): Promise<ReplExecutionResult<TCommand>> | ReplExecutionResult<TCommand>;
  needsContinuation?(input: string): boolean;
}

export interface ReplResult<TCommand = unknown> extends ReplExecutionResult<TCommand> {
  pending: boolean;
}

export class ReplEngine<TCommand = unknown> {
  private pendingInput = "";

  constructor(private readonly callbacks: ReplCallbacks<TCommand>) {}

  async evaluate(line: string): Promise<ReplResult<TCommand>> {
    this.pendingInput = this.pendingInput.length > 0 ? `${this.pendingInput}\n${line}` : line;

    const continuationChecker = this.callbacks.needsContinuation ?? needsContinuation;
    if (continuationChecker(this.pendingInput)) {
      return { pending: true };
    }

    const source = this.pendingInput;
    this.pendingInput = "";

    const result = await this.callbacks.execute(source);

    return {
      command: result.command,
      output: result.output,
      pending: false
    };
  }
}

function needsContinuation(input: string): boolean {
  const lines = input.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  if (lastLine.endsWith("\\")) {
    return true;
  }

  const tokens = scan(input);
  let bracketBalance = 0;

  for (const token of tokens) {
    if (token.type !== "delimiter") continue;
    if (token.value === "(" || token.value === "[" || token.value === "{") bracketBalance += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") bracketBalance -= 1;
  }

  return bracketBalance > 0;
}
