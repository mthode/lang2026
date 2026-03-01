import { scan } from "../scanner/index.js";
import {
  createShellEnvironment,
  executeShellCommand,
  parseShellScript,
  type ShellCommandNode,
  type ShellStatementNode
} from "../shell/index.js";
import type { ShellEnvironment } from "../shell/commands/types.js";

export interface ReplResult {
  command?: ShellCommandNode;
  output?: string;
  pending: boolean;
}

export type ReplEvaluator = (
  statement: ShellStatementNode,
  environment: ShellEnvironment
) => Promise<string | undefined> | string | undefined;

export class ReplEngine {
  private pendingInput = "";
  private readonly environment: ShellEnvironment;

  constructor(private readonly evaluator?: ReplEvaluator, environment: ShellEnvironment = createShellEnvironment()) {
    this.environment = environment;
  }

  async evaluate(line: string): Promise<ReplResult> {
    this.pendingInput = this.pendingInput.length > 0 ? `${this.pendingInput}\n${line}` : line;

    if (needsContinuation(this.pendingInput)) {
      return { pending: true };
    }

    const source = this.pendingInput;
    this.pendingInput = "";

    const statements = parseShellScript(source);
    let lastCommand: ShellCommandNode | undefined;
    const outputs: string[] = [];

    for (const statement of statements) {
      const output = this.evaluator
        ? await evaluateWithCustomEvaluator(statement, this.evaluator, this.environment)
        : executeShellCommand(statement, this.environment);
      if (output !== undefined) {
        outputs.push(output);
      }

      if (statement.kind === "command") {
        lastCommand = statement;
      }
    }

    return {
      command: lastCommand,
      output: outputs.length > 0 ? outputs.join("\n") : undefined,
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

async function evaluateWithCustomEvaluator(
  statement: ShellStatementNode,
  evaluator: ReplEvaluator,
  environment: ShellEnvironment
): Promise<string | undefined> {
  return evaluator(statement, environment);
}
