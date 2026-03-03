import { splitLogicalLinesWithMetadata } from "../../scanner/index.js";
import type { ParserScope } from "../../parser/index.js";
import type { ShellCommandContext, ShellEnvironment } from "../commands/types.js";
import { substituteStatementVariables } from "./expression.js";

export function executeBodyStatements(
  bodyContent: string,
  context: ShellCommandContext,
  environment: ShellEnvironment,
  localVariables: Record<string, number> = {},
  scope?: ParserScope
): string[] {
  const outputs: string[] = [];
  const lines = splitLogicalLinesWithMetadata(bodyContent);

  for (const line of lines) {
    const source = substituteStatementVariables(line.content, environment, localVariables);
    const statement = context.parseLine(source, line.startLine, scope);
    const output = context.executeStatement(statement, environment);
    if (output !== undefined) {
      outputs.push(output);
    }
  }

  return outputs;
}
