import { extractNestedBlock, parseExpressionFromTokens, type ExpressionNode } from "../../parser/index.js";
import { scan, splitLogicalLinesWithMetadata } from "../../scanner/index.js";
import type { ShellEnvironment } from "../commands/types.js";
import { shellExpressionConfig } from "../expression-config.js";
import { withLocalVariables } from "./local-scope.js";

type FunctionBodyStatement =
  | { kind: "expression"; value: ExpressionNode }
  | { kind: "if"; condition: ExpressionNode; thenBody: FunctionBodyStatement[]; elseBody?: FunctionBodyStatement[] };

export type ExpressionEvaluator = (expression: ExpressionNode, environment: ShellEnvironment) => number;

export function evaluateFunctionCallExpression(
  expression: Extract<ExpressionNode, { kind: "call" }>,
  environment: ShellEnvironment,
  evaluateExpression: ExpressionEvaluator
): number {
  if (expression.callee.kind !== "identifier") {
    throw new Error("Only named function calls are supported in expressions");
  }

  const functionName = expression.callee.name;

  if (environment.commands.has(functionName)) {
    throw new Error(`Cannot call command '${functionName}' as a function`);
  }

  const definition = environment.expressionFunctions.get(functionName);
  if (!definition) {
    throw new Error(`Unknown function '${functionName}'`);
  }

  const callArgs = expandCallArguments(expression.args);
  const values = callArgs.map((arg) => evaluateExpression(arg, environment));
  if (values.length !== definition.parameters.length) {
    throw new Error(
      `Function '${functionName}' expects ${definition.parameters.length} argument(s), got ${values.length}`
    );
  }

  const scopedValues = Object.fromEntries(definition.parameters.map((name, index) => [name, values[index] ?? 0]));

  return withLocalVariables(environment, scopedValues, () => evaluateFunctionBody(definition.body, environment, evaluateExpression));
}

function expandCallArguments(args: ExpressionNode[]): ExpressionNode[] {
  if (args.length !== 1) {
    return args;
  }

  const single = args[0];
  if (!single || single.kind !== "binary" || single.operator !== ",") {
    return args;
  }

  return flattenCommaExpression(single);
}

function flattenCommaExpression(expression: Extract<ExpressionNode, { kind: "binary" }>): ExpressionNode[] {
  const result: ExpressionNode[] = [];

  const collect = (node: ExpressionNode): void => {
    if (node.kind === "binary" && node.operator === ",") {
      collect(node.left);
      collect(node.right);
      return;
    }

    result.push(node);
  };

  collect(expression);
  return result;
}

function evaluateFunctionBody(body: string, environment: ShellEnvironment, evaluateExpression: ExpressionEvaluator): number {
  const statements = parseFunctionBodyStatements(body);
  return evaluateFunctionBodyStatements(statements, environment, evaluateExpression);
}

function evaluateFunctionBodyStatements(
  statements: FunctionBodyStatement[],
  environment: ShellEnvironment,
  evaluateExpression: ExpressionEvaluator
): number {
  let lastValue = 0;

  for (const statement of statements) {
    if (statement.kind === "expression") {
      lastValue = evaluateExpression(statement.value, environment);
      continue;
    }

    const conditionValue = evaluateExpression(statement.condition, environment);
    if (conditionValue !== 0) {
      lastValue = evaluateFunctionBodyStatements(statement.thenBody, environment, evaluateExpression);
      continue;
    }

    if (statement.elseBody) {
      lastValue = evaluateFunctionBodyStatements(statement.elseBody, environment, evaluateExpression);
      continue;
    }

    lastValue = 0;
  }

  return lastValue;
}

function parseFunctionBodyStatements(body: string): FunctionBodyStatement[] {
  const lines = splitLogicalLinesWithMetadata(body);
  return lines.map((line) => parseFunctionBodyStatement(line.content.trim()));
}

function parseFunctionBodyStatement(source: string): FunctionBodyStatement {
  if (source.length === 0) {
    return {
      kind: "expression",
      value: { kind: "number", value: 0, raw: "0" }
    };
  }

  if (source.startsWith("if") && /\s/.test(source[2] ?? "")) {
    return parseFunctionIfStatement(source);
  }

  return {
    kind: "expression",
    value: parseExpressionFromSource(source)
  };
}

function parseFunctionIfStatement(source: string): FunctionBodyStatement {
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

  let elseBody: FunctionBodyStatement[] | undefined;
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
    elseBody = parseFunctionBodyStatements(elseBlock.content);
  }

  return {
    kind: "if",
    condition: parseExpressionFromSource(conditionSource),
    thenBody: parseFunctionBodyStatements(thenBlock.content),
    elseBody
  };
}

function parseExpressionFromSource(source: string): ExpressionNode {
  return parseExpressionFromTokens(scan(source), shellExpressionConfig);
}
