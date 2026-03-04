import { extractNestedBlock, type ExpressionNode } from "../../parser/index.js";
import { scan, type Token } from "../../scanner/index.js";
import type { ShellEnvironment } from "../commands/types.js";
import { withLocalVariables } from "../utils/local-scope.js";
import { parseStatementExpressionSource } from "./expression.js";

const MAX_LOOP_ITERATIONS = 10_000;

export interface FunctionForStatement<TStatement> {
  kind: "for";
  iterator: string;
  from: ExpressionNode;
  to: ExpressionNode;
  step: ExpressionNode;
  body: TStatement[];
}

export function parseFunctionForStatement<TStatement>(
  source: string,
  parseBody: (body: string) => TStatement[]
): FunctionForStatement<TStatement> {
  const afterFor = source.slice("for".length).trim();
  const blockStart = afterFor.indexOf("{");
  if (blockStart < 0) {
    throw new Error("Function for-statement requires a '{ ... }' body block");
  }

  const rawHeader = afterFor.slice(0, blockStart).trim();
  const header = rawHeader.endsWith("do") ? rawHeader.slice(0, rawHeader.length - 2).trim() : rawHeader;

  const iteratorMatch = /^([A-Za-z_][A-Za-z0-9_]*)\b/.exec(header);
  if (!iteratorMatch || !iteratorMatch[1]) {
    throw new Error("Function for-statement iterator must be an identifier");
  }

  const iterator = iteratorMatch[1];
  const ranges = parseForHeaderRanges(header.slice(iteratorMatch[0].length).trim());

  const bodyBlock = extractNestedBlock(afterFor, blockStart);
  const trailing = afterFor.slice(bodyBlock.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error("Unexpected trailing content after function for-statement");
  }

  return {
    kind: "for",
    iterator,
    from: parseStatementExpressionSource(ranges.fromSource),
    to: parseStatementExpressionSource(ranges.toSource),
    step: parseStatementExpressionSource(ranges.stepSource ?? "1"),
    body: parseBody(bodyBlock.content)
  };
}

export function evaluateFunctionForStatement<TStatement>(
  statement: FunctionForStatement<TStatement>,
  environment: ShellEnvironment,
  evaluateExpression: (expression: ExpressionNode, environment: ShellEnvironment) => number,
  evaluateStatements: (statements: TStatement[], environment: ShellEnvironment) => number
): number {
  const start = evaluateExpression(statement.from, environment);
  const end = evaluateExpression(statement.to, environment);
  const step = evaluateExpression(statement.step, environment);

  if (step === 0) {
    throw new Error("Function for-statement step cannot be 0");
  }

  let iterations = 0;
  let lastValue = 0;

  if (step > 0) {
    for (let value = start; value <= end; value += step) {
      if (iterations >= MAX_LOOP_ITERATIONS) {
        throw new Error(`Function 'for' exceeded max iterations (${MAX_LOOP_ITERATIONS})`);
      }
      iterations += 1;

      lastValue = withLocalVariables(environment, { [statement.iterator]: value }, () =>
        evaluateStatements(statement.body, environment)
      );
    }
    return lastValue;
  }

  for (let value = start; value >= end; value += step) {
    if (iterations >= MAX_LOOP_ITERATIONS) {
      throw new Error(`Function 'for' exceeded max iterations (${MAX_LOOP_ITERATIONS})`);
    }
    iterations += 1;

    lastValue = withLocalVariables(environment, { [statement.iterator]: value }, () => evaluateStatements(statement.body, environment));
  }

  return lastValue;
}

function parseForHeaderRanges(headerRemainder: string): { fromSource: string; toSource: string; stepSource?: string } {
  const tokens = scan(headerRemainder).filter((token) => token.type !== "whitespace" && token.type !== "comment");
  if (tokens.length === 0) {
    throw new Error("Function for-statement requires 'from' and 'to' expressions");
  }

  const fromToken = tokens[0];
  if (!fromToken || fromToken.type !== "identifier" || fromToken.value !== "from") {
    throw new Error("Function for-statement requires a 'from' clause");
  }

  const toTokenIndex = findTopLevelKeywordToken(tokens, "to", 1);
  if (toTokenIndex < 0) {
    throw new Error("Function for-statement requires a 'to' clause");
  }

  const toToken = tokens[toTokenIndex];
  if (!toToken) {
    throw new Error("Function for-statement requires a 'to' clause");
  }

  const stepTokenIndex = findTopLevelKeywordToken(tokens, "step", toTokenIndex + 1);
  const stepToken = stepTokenIndex >= 0 ? tokens[stepTokenIndex] : undefined;

  const fromStart = fromToken.offset + fromToken.value.length;
  const fromEnd = toToken.offset;
  const toStart = toToken.offset + toToken.value.length;
  const toEnd = stepToken ? stepToken.offset : headerRemainder.length;
  const stepStart = stepToken ? stepToken.offset + stepToken.value.length : -1;

  const fromSource = headerRemainder.slice(fromStart, fromEnd).trim();
  const toSource = headerRemainder.slice(toStart, toEnd).trim();
  const stepSource = stepToken ? headerRemainder.slice(stepStart).trim() : undefined;

  if (fromSource.length === 0) {
    throw new Error("Function for-statement requires a non-empty 'from' expression");
  }

  if (toSource.length === 0) {
    throw new Error("Function for-statement requires a non-empty 'to' expression");
  }

  if (stepToken && (!stepSource || stepSource.length === 0)) {
    throw new Error("Function for-statement requires a non-empty 'step' expression");
  }

  return { fromSource, toSource, stepSource };
}

function findTopLevelKeywordToken(tokens: Token[], keyword: string, startIndex: number): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (
      token.type === "identifier" &&
      token.value === keyword &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }

    if (token.type !== "delimiter") {
      continue;
    }

    if (token.value === "(") parenDepth += 1;
    if (token.value === ")") parenDepth -= 1;
    if (token.value === "[") bracketDepth += 1;
    if (token.value === "]") bracketDepth -= 1;
    if (token.value === "{") braceDepth += 1;
    if (token.value === "}") braceDepth -= 1;
  }

  return -1;
}
