import { splitLogicalLinesWithMetadata } from "../../scanner/index.js";
import type { Language } from "../../parser/index.js";
import type { ShellCommandContext, ShellEnvironment } from "../commands/types.js";

export function executeBodyStatements(
  bodyContent: string,
  context: ShellCommandContext,
  environment: ShellEnvironment,
  scope?: Language
): string[] {
  const outputs: string[] = [];
  const lines = splitLogicalLinesWithMetadata(bodyContent);

  for (const line of lines) {
    const statement = context.parseLine(line.content, environment, line.startLine, scope);
    const output = context.executeStatement(statement, environment, scope);
    if (output !== undefined) {
      outputs.push(output);
    }
  }

  return outputs;
}
