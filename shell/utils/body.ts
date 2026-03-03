import { splitLogicalLinesWithMetadata } from "../../scanner/index.js";
import type { ParserScope } from "../../parser/index.js";
import type { ShellCommandContext, ShellEnvironment } from "../commands/types.js";

export function executeBodyStatements(
  bodyContent: string,
  context: ShellCommandContext,
  environment: ShellEnvironment,
  scope?: ParserScope
): string[] {
  const outputs: string[] = [];
  const lines = splitLogicalLinesWithMetadata(bodyContent);

  for (const line of lines) {
    const statement = context.parseLine(line.content, environment, line.startLine, scope);
    const output = context.executeStatement(statement, environment);
    if (output !== undefined) {
      outputs.push(output);
    }
  }

  return outputs;
}
