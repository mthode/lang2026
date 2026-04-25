import type { ExpressionNode, NestedBlockNode } from "../../parser/index.js";
import { evaluateLangExpression } from "../../lang/expression.js";
import { executeBodyStatements } from "../utils/body.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeIfCommand: ShellCommandExecutor = (command, context, environment, scope) => {
  const conditionValue = command.args.condition as ExpressionNode;
  const thenBlockArg = command.blocks.then as NestedBlockNode;
  const elseBlockArg = command.blocks.else as NestedBlockNode | undefined;

  const conditionResult = evaluateConditionExpression(conditionValue, environment);
  const selectedBlock = conditionResult ? thenBlockArg : elseBlockArg;
  if (!selectedBlock) {
    return undefined;
  }

  const outputs = executeBodyStatements(selectedBlock.content, context, environment, scope);
  return outputs.length > 0 ? outputs.join("\n") : undefined;
};

function evaluateConditionExpression(condition: ExpressionNode, environment: Parameters<ShellCommandExecutor>[2]): boolean {
  const numeric = evaluateLangExpression(condition, environment);
  return numeric !== 0;
}
