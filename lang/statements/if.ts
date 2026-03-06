import { extractNestedBlock, type ExpressionNode } from "../../parser/index.js";
import type { ExpressionRuntimeEnvironment } from "../types.js";
import { parseStatementExpressionSource } from "./expression.js";

export interface FunctionIfStatement<TStatement> {
  kind: "if";
  condition: ExpressionNode;
  thenBody: TStatement[];
  elseBody?: TStatement[];
}

export function parseFunctionIfStatement<TStatement>(
  source: string,
  parseBody: (body: string) => TStatement[]
): FunctionIfStatement<TStatement> {
  const afterIf = source.slice(2).trim();
  const thenBlockStart = afterIf.indexOf("{");
  if (thenBlockStart < 0) {
    throw new Error("Function if-statement requires a '{ ... }' then block");
  }

  const rawCondition = afterIf.slice(0, thenBlockStart).trim();
  const conditionSource = rawCondition.endsWith("then")
    ? rawCondition.slice(0, rawCondition.length - 4).trim()
    : rawCondition;
  if (conditionSource.length === 0) {
    throw new Error("Function if-statement requires a condition expression");
  }

  const thenBlock = extractNestedBlock(afterIf, thenBlockStart);
  const trailing = afterIf.slice(thenBlock.closeIndex + 1).trim();

  let elseBody: TStatement[] | undefined;
  if (trailing.length > 0) {
    if (!trailing.startsWith("else")) {
      throw new Error("Unexpected trailing content after function if-statement");
    }

    const elseSource = trailing.slice(4).trim();
    const elseBlock = extractNestedBlock(elseSource, 0);
    const elseTrailing = elseSource.slice(elseBlock.closeIndex + 1).trim();
    if (elseTrailing.length > 0) {
      throw new Error("Unexpected content after function else block");
    }
    elseBody = parseBody(elseBlock.content);
  }

  return {
    kind: "if",
    condition: parseStatementExpressionSource(conditionSource),
    thenBody: parseBody(thenBlock.content),
    elseBody
  };
}

export function evaluateFunctionIfStatement<TStatement>(
  statement: FunctionIfStatement<TStatement>,
  environment: ExpressionRuntimeEnvironment,
  evaluateExpression: (expression: ExpressionNode, environment: ExpressionRuntimeEnvironment) => number,
  evaluateStatements: (statements: TStatement[], environment: ExpressionRuntimeEnvironment) => number
): number {
  const conditionValue = evaluateExpression(statement.condition, environment);
  if (conditionValue !== 0) {
    return evaluateStatements(statement.thenBody, environment);
  }

  if (statement.elseBody) {
    return evaluateStatements(statement.elseBody, environment);
  }

  return 0;
}
