import type { ExpressionNode, NestedBlockNode } from "../../parser/index.js";
import { executeBodyStatements } from "../utils/body.js";
import { evaluateShellExpression } from "../utils/expression.js";
import { withLocalVariables } from "../utils/local-scope.js";
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

    const conditionValue = withLocalVariables(environment, { loop }, () => evaluateShellExpression(condition, environment));
    if (conditionValue === 0) {
      break;
    }

    const bodyOutputs = withLocalVariables(environment, { loop }, () =>
      executeBodyStatements(body.content, context, environment, body.scope)
    );
    outputs.push(...bodyOutputs);

    loop += 1;
  }

  return outputs.length > 0 ? outputs.join("\n") : undefined;
};
