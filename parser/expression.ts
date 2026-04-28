import type { Token } from "../scanner/index.js";

export type ExpressionNode =
  | IdentifierExpressionNode
  | NumberExpressionNode
  | StringExpressionNode
  | PrefixExpressionNode
  | BinaryExpressionNode
  | CallExpressionNode;

export class IdentifierExpressionNode {
  readonly kind = "identifier";

  constructor(readonly name: string) {}
}

export class NumberExpressionNode {
  readonly kind = "number";

  constructor(
    readonly value: number,
    readonly raw: string
  ) {}
}

export class StringExpressionNode {
  readonly kind = "string";

  constructor(
    readonly value: string,
    readonly raw: string
  ) {}
}

export class PrefixExpressionNode {
  readonly kind = "prefix";

  constructor(
    readonly operator: string,
    readonly right: ExpressionNode
  ) {}
}

export class BinaryExpressionNode {
  readonly kind = "binary";

  constructor(
    readonly operator: string,
    readonly left: ExpressionNode,
    readonly right: ExpressionNode
  ) {}
}

export class CallExpressionNode {
  readonly kind = "call";

  constructor(
    readonly callee: ExpressionNode,
    readonly args: ExpressionNode[]
  ) {}
}

export class PrefixOperatorDefinition {
  constructor(readonly precedence: number) {}
}

export class InfixOperatorDefinition {
  constructor(
    readonly precedence: number,
    readonly associativity?: "left" | "right"
  ) {}
}

export class ExpressionOperatorOverrides {
  constructor(
    readonly prefixOperators?: Record<string, PrefixOperatorDefinition>,
    readonly infixOperators?: Record<string, InfixOperatorDefinition>
  ) {}
}

export class ExpressionParserConfig {
  constructor(
    readonly prefixOperators: Record<string, PrefixOperatorDefinition>,
    readonly infixOperators: Record<string, InfixOperatorDefinition>
  ) {}
}

interface ParserState {
  tokens: Token[];
  index: number;
  config: ExpressionParserConfig;
  lineOffset: number;
}

export function hasLinePrefix(message: string): boolean {
  return /(^|:\s)Line \d+(, column \d+)?:/.test(message);
}

function formatParserError(message: string, line: number, column?: number): Error {
  if (column !== undefined) {
    return new Error(`Line ${line}, column ${column}: ${message}`);
  }

  return new Error(`Line ${line}: ${message}`);
}

function tokenAbsoluteLine(token: Token, lineOffset: number): number {
  return token.line + lineOffset - 1;
}

export function createParserError(message: string, lineOffset: number, token?: Token, fallbackLine = lineOffset): Error {
  if (token) {
    return formatParserError(message, tokenAbsoluteLine(token, lineOffset), token.column);
  }

  return formatParserError(message, fallbackLine);
}

export function withParserErrorContext<T>(lineOffset: number, fallbackToken: Token | undefined, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (hasLinePrefix(message)) {
      throw error;
    }

    throw createParserError(message, lineOffset, fallbackToken, lineOffset);
  }
}

export function isIgnorable(token: Token): boolean {
  return token.type === "whitespace" || token.type === "comment" || token.type === "newline";
}

export function compactTokens(tokens: Token[]): Token[] {
  return tokens.filter((t) => !isIgnorable(t));
}

export function applyExpressionOperatorOverrides(
  config: ExpressionParserConfig,
  overrides?: ExpressionOperatorOverrides
): ExpressionParserConfig {
  if (!overrides) {
    return config;
  }

  return {
    prefixOperators: {
      ...config.prefixOperators,
      ...(overrides.prefixOperators ?? {})
    },
    infixOperators: {
      ...config.infixOperators,
      ...(overrides.infixOperators ?? {})
    }
  };
}

function peek(state: ParserState): Token | undefined {
  return state.tokens[state.index];
}

function consume(state: ParserState): Token | undefined {
  const token = state.tokens[state.index];
  state.index += 1;
  return token;
}

function parsePrimary(state: ParserState): ExpressionNode {
  const token = consume(state);

  if (!token) {
    throw createParserError("Unexpected end of expression", state.lineOffset);
  }

  if (token.type === "identifier") {
    let node: ExpressionNode = new IdentifierExpressionNode(token.value);

    while (peek(state)?.value === "(") {
      consume(state);
      const args: ExpressionNode[] = [];

      if (peek(state)?.value !== ")") {
        while (true) {
          args.push(parseExpression(state));
          if (peek(state)?.value === ",") {
            consume(state);
            continue;
          }
          break;
        }
      }

      if (peek(state)?.value !== ")") {
        throw createParserError("Expected ')' in call expression", state.lineOffset, peek(state));
      }
      consume(state);
      node = new CallExpressionNode(node, args);
    }

    return node;
  }

  if (token.type === "number") {
    return new NumberExpressionNode(Number(token.value.replaceAll("_", "")), token.value);
  }

  if (token.type === "string") {
    const unquoted = token.value.slice(1, Math.max(1, token.value.length - 1));
    return new StringExpressionNode(unquoted, token.value);
  }

  if (token.value === "(") {
    const expr = parseExpression(state);
    if (peek(state)?.value !== ")") {
      throw createParserError("Expected ')' after grouped expression", state.lineOffset, peek(state));
    }
    consume(state);
    return expr;
  }

  const prefixOperator = state.config.prefixOperators[token.value];
  if (prefixOperator) {
    const right = parseExpression(state, prefixOperator.precedence);
    return new PrefixExpressionNode(token.value, right);
  }

  throw createParserError(`Unexpected token '${token.value}'`, state.lineOffset, token);
}

function parseExpression(state: ParserState, minPrecedence = 0): ExpressionNode {
  let left = parsePrimary(state);

  while (true) {
    const token = peek(state);
    if (!token) break;

    const infixOperator = state.config.infixOperators[token.value];
    if (!infixOperator || infixOperator.precedence < minPrecedence) {
      break;
    }

    const operator = token.value;
    consume(state);

    const nextMinPrecedence = infixOperator.associativity === "right" ? infixOperator.precedence : infixOperator.precedence + 1;
    const right = parseExpression(state, nextMinPrecedence);
    left = new BinaryExpressionNode(operator, left, right);
  }

  return left;
}

export function parseExpressionFromTokens(tokens: Token[], config: ExpressionParserConfig, lineOffset = 1): ExpressionNode {
  const compact = compactTokens(tokens);
  if (compact.length === 0) {
    throw createParserError("Expected expression", lineOffset);
  }

  const state: ParserState = { tokens: compact, index: 0, config, lineOffset };
  const value = parseExpression(state);

  if (state.index < compact.length) {
    const next = compact[state.index];
    throw createParserError(`Unexpected token '${next?.value ?? ""}' after expression`, lineOffset, next);
  }

  return value;
}
