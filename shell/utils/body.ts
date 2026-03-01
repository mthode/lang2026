import { splitLogicalLines } from "../../scanner/index.js";
import type { ShellCommandContext, ShellEnvironment } from "../commands/types.js";
import { substituteStatementVariables } from "./expression.js";

export function executeBodyStatements(
  bodyContent: string,
  context: ShellCommandContext,
  environment: ShellEnvironment,
  localVariables: Record<string, number> = {}
): string[] {
  const outputs: string[] = [];
  const lines = splitLogicalLines(bodyContent);

  for (const line of lines) {
    const source = substituteStatementVariables(line, environment, localVariables);
    const statement = context.parseLine(source);
    const output = context.executeStatement(statement, environment);
    if (output !== undefined) {
      outputs.push(output);
    }
  }

  return outputs;
}
