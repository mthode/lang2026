import { parseExpressionFromTokens, type ExpressionNode } from "../parser/index.js";
import { scan, splitLogicalLinesWithMetadata } from "../scanner/index.js";
import { expressionConfig } from "./expression-config.js";
import { evaluateForStatement, parseForStatement, type ForStatement } from "./statements/for.js";
import { evaluateIfStatement, parseIfStatement, type IfStatement } from "./statements/if.js";
import { evaluateWhileStatement, parseWhileStatement, type WhileStatement } from "./statements/while.js";
import { withLocalVariables } from "./local-scope.js";
import type { ExpressionRuntimeEnvironment } from "./types.js";

type FunctionBodyStatement =
  | { kind: "expression"; value: ExpressionNode }
  | IfStatement<FunctionBodyStatement>
  | WhileStatement<FunctionBodyStatement>
  | ForStatement<FunctionBodyStatement>;

export type ExpressionEvaluator = (expression: ExpressionNode, environment: ExpressionRuntimeEnvironment) => number;

export function evaluateFunctionCallExpression(
  expression: Extract<ExpressionNode, { kind: "call" }>,
  environment: ExpressionRuntimeEnvironment,
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

function evaluateFunctionBody(body: string, environment: ExpressionRuntimeEnvironment, evaluateExpression: ExpressionEvaluator): number {
  const statements = parseFunctionBodyStatements(body);
  return evaluateFunctionBodyStatements(statements, environment, evaluateExpression);
}

function evaluateFunctionBodyStatements(
  statements: FunctionBodyStatement[],
  environment: ExpressionRuntimeEnvironment,
  evaluateExpression: ExpressionEvaluator
): number {
  let lastValue = 0;

  for (const statement of statements) {
    if (statement.kind === "expression") {
      lastValue = evaluateExpression(statement.value, environment);
      continue;
    }

    if (statement.kind === "if") {
      lastValue = evaluateIfStatement(statement, environment, evaluateExpression, (nestedStatements, nestedEnvironment) =>
        evaluateFunctionBodyStatements(nestedStatements, nestedEnvironment, evaluateExpression)
      );
      continue;
    }

    if (statement.kind === "while") {
      lastValue = evaluateWhileStatement(statement, environment, evaluateExpression, (nestedStatements, nestedEnvironment) =>
        evaluateFunctionBodyStatements(nestedStatements, nestedEnvironment, evaluateExpression)
      );
      continue;
    }

    lastValue = evaluateForStatement(statement, environment, evaluateExpression, (nestedStatements, nestedEnvironment) =>
      evaluateFunctionBodyStatements(nestedStatements, nestedEnvironment, evaluateExpression)
    );
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
    return parseIfStatement(source, parseFunctionBodyStatements);
  }

  if (source.startsWith("while") && /\s/.test(source[5] ?? "")) {
    return parseWhileStatement(source, parseFunctionBodyStatements);
  }

  if (source.startsWith("for") && /\s/.test(source[3] ?? "")) {
    return parseForStatement(source, parseFunctionBodyStatements);
  }

  return {
    kind: "expression",
    value: parseExpressionFromSource(source)
  };
}

function parseExpressionFromSource(source: string): ExpressionNode {
  return parseExpressionFromTokens(scan(source), expressionConfig);
}
