import type { ExpressionNode, NestedBlockNode } from "../../parser/index.js";
import { executeBodyStatements } from "../utils/body.js";
import { evaluateShellExpression } from "../utils/expression.js";
import type { ShellCommandExecutor } from "./types.js";

const MAX_LOOP_ITERATIONS = 10_000;

export const executeWhileCommand: ShellCommandExecutor = (command, context, environment) => {
  const condition = command.args.condition as ExpressionNode;
  const body = command.args.do as NestedBlockNode;

  const outputs: string[] = [];
  let loop = 0;

  while (true) {
    if (loop >= MAX_LOOP_ITERATIONS) {
      throw new Error(`'while' exceeded max iterations (${MAX_LOOP_ITERATIONS})`);
    }

    const conditionValue = evaluateShellExpression(condition, environment, { loop });
    if (conditionValue === 0) {
      break;
    }

    outputs.push(...executeBodyStatements(body.content, context, environment, { loop }));

    loop += 1;
  }

  return outputs.length > 0 ? outputs.join("\n") : undefined;
};
