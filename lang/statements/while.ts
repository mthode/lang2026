import { extractNestedBlock, type ExpressionNode } from "../../parser/index.js";
import { withLocalVariables } from "../local-scope.js";
import type { ExpressionRuntimeEnvironment } from "../types.js";
import { parseStatementExpressionSource } from "./expression.js";

const MAX_LOOP_ITERATIONS = 10_000;

export interface FunctionWhileStatement<TStatement> {
  kind: "while";
  condition: ExpressionNode;
  body: TStatement[];
}

export function parseFunctionWhileStatement<TStatement>(
  source: string,
  parseBody: (body: string) => TStatement[]
): FunctionWhileStatement<TStatement> {
  const afterWhile = source.slice("while".length).trim();
  const blockStart = afterWhile.indexOf("{");
  if (blockStart < 0) {
    throw new Error("Function while-statement requires a '{ ... }' body block");
  }

  const rawCondition = afterWhile.slice(0, blockStart).trim();
  const conditionSource = rawCondition.endsWith("do") ? rawCondition.slice(0, rawCondition.length - 2).trim() : rawCondition;
  if (conditionSource.length === 0) {
    throw new Error("Function while-statement requires a condition expression");
  }

  const bodyBlock = extractNestedBlock(afterWhile, blockStart);
  const trailing = afterWhile.slice(bodyBlock.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error("Unexpected trailing content after function while-statement");
  }

  return {
    kind: "while",
    condition: parseStatementExpressionSource(conditionSource),
    body: parseBody(bodyBlock.content)
  };
}

export function evaluateFunctionWhileStatement<TStatement>(
  statement: FunctionWhileStatement<TStatement>,
  environment: ExpressionRuntimeEnvironment,
  evaluateExpression: (expression: ExpressionNode, environment: ExpressionRuntimeEnvironment) => number,
  evaluateStatements: (statements: TStatement[], environment: ExpressionRuntimeEnvironment) => number
): number {
  let loop = 0;
  let lastValue = 0;

  while (true) {
    if (loop >= MAX_LOOP_ITERATIONS) {
      throw new Error(`Function 'while' exceeded max iterations (${MAX_LOOP_ITERATIONS})`);
    }

    const conditionValue = withLocalVariables(environment, { loop }, () => evaluateExpression(statement.condition, environment));
    if (conditionValue === 0) {
      break;
    }

    lastValue = withLocalVariables(environment, { loop }, () => evaluateStatements(statement.body, environment));
    loop += 1;
  }

  return lastValue;
}
