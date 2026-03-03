import type { ExpressionNode, NestedBlockNode } from "../../parser/index.js";
import { executeBodyStatements } from "../utils/body.js";
import { evaluateShellExpression } from "../utils/expression.js";
import { withLocalVariables } from "../utils/local-scope.js";
import type { ShellCommandExecutor } from "./types.js";

const MAX_LOOP_ITERATIONS = 10_000;

export const executeForCommand: ShellCommandExecutor = (command, context, environment) => {
  const iterator = command.args.iterator as ExpressionNode;
  if (iterator.kind !== "identifier") {
    throw new Error("'for' iterator must be an identifier");
  }

  const fromExpr = command.args.from as ExpressionNode;
  const toExpr = command.args.to as ExpressionNode;
  const stepExpr = (command.args.step as ExpressionNode | undefined) ?? { kind: "number", value: 1, raw: "1" };
  const body = command.args.do as NestedBlockNode;

  const start = evaluateShellExpression(fromExpr, environment);
  const end = evaluateShellExpression(toExpr, environment);
  const step = evaluateShellExpression(stepExpr, environment);

  if (step === 0) {
    throw new Error("'for' step cannot be 0");
  }

  const outputs: string[] = [];
  let iterations = 0;

  if (step > 0) {
    for (let value = start; value <= end; value += step) {
      if (iterations >= MAX_LOOP_ITERATIONS) {
        throw new Error(`'for' exceeded max iterations (${MAX_LOOP_ITERATIONS})`);
      }
      iterations += 1;

      const bodyOutputs = withLocalVariables(environment, { [iterator.name]: value }, () =>
        executeBodyStatements(body.content, context, environment, body.scope)
      );
      outputs.push(...bodyOutputs);
    }
  } else {
    for (let value = start; value >= end; value += step) {
      if (iterations >= MAX_LOOP_ITERATIONS) {
        throw new Error(`'for' exceeded max iterations (${MAX_LOOP_ITERATIONS})`);
      }
      iterations += 1;

      const bodyOutputs = withLocalVariables(environment, { [iterator.name]: value }, () =>
        executeBodyStatements(body.content, context, environment, body.scope)
      );
      outputs.push(...bodyOutputs);
    }
  }

  return outputs.length > 0 ? outputs.join("\n") : undefined;
};
