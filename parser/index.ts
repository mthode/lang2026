export * from "./expression.js";
export * from "./command.js";
export * from "./language.js";
export * from "./declaration.js";
export * from "./invocation.js";

/*
import { scan, splitLogicalLinesWithMetadata, type Token } from "../scanner/index.js";

export type ExpressionNode =
  | { kind: "identifier"; name: string }
  | { kind: "number"; value: number; raw: string }
  | { kind: "string"; value: string; raw: string }
  | { kind: "prefix"; operator: string; right: ExpressionNode }
  | { kind: "binary"; operator: string; left: ExpressionNode; right: ExpressionNode }
  | { kind: "call"; callee: ExpressionNode; args: ExpressionNode[] };

export interface NestedBlockNode {
  kind: "nested-block";
  content: string;
}

export type ArgumentValue = ExpressionNode | string | NestedBlockNode;
export type CommandArguments = Record<string, ArgumentValue | ArgumentValue[]>;

export interface CommandNode {
  kind: "command";
  name: string;
  args: CommandArguments;
  raw: string;
}

export interface AssignmentStatementNode {
  kind: "assignment";
  name: string;
  value: ExpressionNode;
  raw: string;
}

export type StatementNode = CommandNode | AssignmentStatementNode;

export type ArgumentKind = "expression" | "raw" | "nested-block";

export interface CommandDefinition {
  arguments?: CommandArgumentDefinition[];
  allowExtraArguments?: boolean;
  argumentKind?: ArgumentKind;
  parseNamedArguments?: boolean;
  consumeRestAsSingleArgument?: boolean;
}

export interface CommandArgumentDefinition {
  name: string;
  kind: ArgumentKind;
  positional?: boolean;
  optional?: boolean;
  vararg?: boolean;
}

export interface PrefixOperatorDefinition {
  precedence: number;
}

export interface InfixOperatorDefinition {
  precedence: number;
  associativity?: "left" | "right";
}

export interface ParserConfig {
  prefixOperators: Record<string, PrefixOperatorDefinition>;
  infixOperators: Record<string, InfixOperatorDefinition>;
  allowAssignmentStatements?: boolean;
  commands?: Record<string, CommandDefinition>;
  strictCommands?: boolean;
  defaultCommand?: CommandDefinition;
}

export interface GenericParser {
  parseLine(line: string, startLine?: number): StatementNode;
  parseScript(input: string): StatementNode[];
}

interface ParserState {
  tokens: Token[];
  index: number;
  config: ParserConfig;
  lineOffset: number;
}

function hasLinePrefix(message: string): boolean {
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

function createParserError(message: string, lineOffset: number, token?: Token, fallbackLine = lineOffset): Error {
  if (token) {
    return formatParserError(message, tokenAbsoluteLine(token, lineOffset), token.column);
  }
  return formatParserError(message, fallbackLine);
}

function withParserErrorContext<T>(lineOffset: number, fallbackToken: Token | undefined, fn: () => T): T {
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

function isIgnorable(token: Token): boolean {
  return token.type === "whitespace" || token.type === "comment" || token.type === "newline";
}

function compactTokens(tokens: Token[]): Token[] {
  return tokens.filter((t) => !isIgnorable(t));
}

function peek(state: ParserState): Token | undefined {
  return state.tokens[state.index];
}

function consume(state: ParserState): Token | undefined {
  const token = state.tokens[state.index];
  state.index += 1;
  return token;
}

function normalizeCommandDefinition(definition?: CommandDefinition): Required<CommandDefinition> {
  return {
    arguments: definition?.arguments ?? [],
    allowExtraArguments: definition?.allowExtraArguments ?? false,
    argumentKind: definition?.argumentKind ?? "expression",
    parseNamedArguments: definition?.parseNamedArguments ?? true,
    consumeRestAsSingleArgument: definition?.consumeRestAsSingleArgument ?? false
  };
}

function resolveCommandDefinition(config: ParserConfig, commandName: string): Required<CommandDefinition> {
  const commandDefinition = config.commands?.[commandName];

  if (!commandDefinition && config.strictCommands) {
    throw new Error(`Unknown command '${commandName}'`);
  }

  return normalizeCommandDefinition(commandDefinition ?? config.defaultCommand);
}

function parsePrimary(state: ParserState): ExpressionNode {
  const token = consume(state);

  if (!token) {
    throw createParserError("Unexpected end of expression", state.lineOffset);
  }

  if (token.type === "identifier") {
    let node: ExpressionNode = { kind: "identifier", name: token.value };

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
      node = { kind: "call", callee: node, args };
    }

    return node;
  }

  if (token.type === "number") {
    return { kind: "number", value: Number(token.value.replaceAll("_", "")), raw: token.value };
  }

  if (token.type === "string") {
    const unquoted = token.value.slice(1, Math.max(1, token.value.length - 1));
    return { kind: "string", value: unquoted, raw: token.value };
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
    return { kind: "prefix", operator: token.value, right };
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
    left = { kind: "binary", operator, left, right };
  }

  return left;
}

function parseArgumentValue(
  tokens: Token[],
  config: ParserConfig,
  commandDefinition: Required<CommandDefinition>,
  lineOffset = 1
): ArgumentValue {
  if (commandDefinition.argumentKind === "nested-block") {
    const text = tokens.map((token) => token.value).join("");
    const block = extractNestedBlock(text);
    const trailing = text.slice(block.closeIndex + 1).trim();
    if (trailing.length > 0) {
      throw new Error("Unexpected content after nested block");
    }
    return { kind: "nested-block", content: block.content };
  }

  if (commandDefinition.argumentKind === "raw") {
    return tokens.map((token) => token.value).join("");
  }

  const compact = compactTokens(tokens);
  if (compact.length === 0) {
    throw new Error("Expected expression");
  }

  if (
    commandDefinition.parseNamedArguments &&
    compact.length >= 2 &&
    compact[0]?.type === "identifier" &&
    !((compact[1]?.type === "operator" && compact[1]?.value === "=") || compact[1]?.type === "delimiter")
  ) {
    return parseExpressionFromTokens(compact.slice(1), config, lineOffset);
  }

  return parseExpressionFromTokens(compact, config, lineOffset);
}

function skipIgnorableTokens(tokens: Token[], from: number): number {
  let cursor = from;
  while (cursor < tokens.length && isIgnorable(tokens[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

function findValueEndForDefinition(
  tokens: Token[],
  from: number,
  stopNames: string[]
): number {
  if (stopNames.length === 0) {
    return tokens.length;
  }

  let depth = 0;
  for (let i = from; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (token.value === "(" || token.value === "[" || token.value === "{") depth += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);

    if (depth === 0 && token.type === "identifier" && stopNames.includes(token.value)) {
      const prev = i > from ? tokens[i - 1] : undefined;
      if (!prev || isIgnorable(prev)) {
        return i;
      }
    }
  }

  return tokens.length;
}

function parseNestedBlockValue(tokens: Token[], from: number): { value: NestedBlockNode; next: number } {
  let cursor = skipIgnorableTokens(tokens, from);

  if (!tokens[cursor] || tokens[cursor]!.value !== "{") {
    throw new Error("Expected nested block starting with '{'");
  }

  const openIndex = cursor;
  cursor += 1;
  let depth = 1;

  while (cursor < tokens.length) {
    const token = tokens[cursor]!;
    if (token.value === "{") depth += 1;
    if (token.value === "}") {
      depth -= 1;
      if (depth === 0) {
        const content = tokens.slice(openIndex + 1, cursor).map((t) => t.value).join("");
        return {
          value: { kind: "nested-block", content },
          next: cursor + 1
        };
      }
    }
    cursor += 1;
  }

  throw new Error("Unterminated nested block");
}

function parseValueByKind(
  tokens: Token[],
  from: number,
  definition: CommandArgumentDefinition,
  stopNames: string[],
  config: ParserConfig,
  commandDefinition: Required<CommandDefinition>,
  lineOffset = 1
): { value: ArgumentValue; next: number } {
  if (definition.kind === "nested-block") {
    const parsed = parseNestedBlockValue(tokens, from);
    return { value: parsed.value, next: parsed.next };
  }

  const start = skipIgnorableTokens(tokens, from);
  const end = findValueEndForDefinition(tokens, start, stopNames);
  const segment = tokens.slice(start, end);

  const value = parseArgumentValue(segment, config, {
    ...commandDefinition,
    argumentKind: definition.kind,
    consumeRestAsSingleArgument: true,
    parseNamedArguments: false
  }, lineOffset);

  return { value, next: end };
}

function parseCommandArgumentsByDefinition(
  tokens: Token[],
  config: ParserConfig,
  commandDefinition: Required<CommandDefinition>,
  lineOffset = 1
): CommandArguments {
  const args: CommandArguments = {};
  const definitions = commandDefinition.arguments;
  let cursor = 0;

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index]!;

    if (definition.vararg && (!definition.positional || index !== definitions.length - 1)) {
      throw new Error(`Vararg argument '${definition.name}' must be the last positional argument`);
    }

    cursor = skipIgnorableTokens(tokens, cursor);

    if (!definition.positional) {
      const nextToken = tokens[cursor];
      const matchesName = nextToken?.type === "identifier" && nextToken.value === definition.name;
      if (!matchesName) {
        if (definition.optional) {
          continue;
        }
        throw new Error(`Missing required named argument '${definition.name}'`);
      }
      cursor += 1;
      cursor = skipIgnorableTokens(tokens, cursor);
    }

    if (cursor >= tokens.length) {
      if (definition.optional) {
        continue;
      }
      throw new Error(`Missing required argument '${definition.name}'`);
    }

    const remainingNamedStops = definitions
      .slice(index + 1)
      .filter((def) => !def.positional)
      .map((def) => def.name);

    if (definition.vararg) {
      const values: ArgumentValue[] = [];
      let varargCursor = skipIgnorableTokens(tokens, cursor);

      if (definition.kind === "nested-block") {
        while (varargCursor < tokens.length) {
          let parsed;
          try {
            parsed = parseValueByKind(tokens, varargCursor, definition, [], config, commandDefinition, lineOffset);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid value for argument '${definition.name}': ${message}`);
          }
          values.push(parsed.value);
          varargCursor = skipIgnorableTokens(tokens, parsed.next);
        }
      } else {
        const segments = splitArguments(tokens.slice(varargCursor));
        for (const segment of segments) {
          let parsedValue: ArgumentValue;
          try {
            parsedValue = parseArgumentValue(segment, config, {
              ...commandDefinition,
              argumentKind: definition.kind,
              consumeRestAsSingleArgument: true,
              parseNamedArguments: false
            }, lineOffset);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid value for argument '${definition.name}': ${message}`);
          }
          values.push(parsedValue);
        }
        varargCursor = tokens.length;
      }

      if (!definition.optional && values.length === 0) {
        throw new Error(`Missing required argument '${definition.name}'`);
      }

      args[definition.name] = values;
      cursor = varargCursor;
      continue;
    }

    let parsed;
    try {
      parsed = parseValueByKind(tokens, cursor, definition, remainingNamedStops, config, commandDefinition, lineOffset);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid value for argument '${definition.name}': ${message}`);
    }
    args[definition.name] = parsed.value;
    cursor = parsed.next;
  }

  cursor = skipIgnorableTokens(tokens, cursor);
  if (!commandDefinition.allowExtraArguments && cursor < tokens.length) {
    throw new Error("Unexpected extra arguments");
  }

  return args;
}

function trimIgnorableEdges(tokens: Token[]): Token[] {
  let start = 0;
  let end = tokens.length;

  while (start < end && isIgnorable(tokens[start]!)) {
    start += 1;
  }

  while (end > start && isIgnorable(tokens[end - 1]!)) {
    end -= 1;
  }

  return tokens.slice(start, end);
}

function splitArguments(tokens: Token[]): Token[][] {
  const segments: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (token.value === "(" || token.value === "[" || token.value === "{") {
      depth += 1;
      current.push(token);
      continue;
    }

    if (token.value === ")" || token.value === "]" || token.value === "}") {
      depth = Math.max(0, depth - 1);
      current.push(token);
      continue;
    }

    if (depth === 0 && isIgnorable(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    current.push(token);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function parseExpressionFromTokens(tokens: Token[], config: ParserConfig, lineOffset = 1): ExpressionNode {
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

export function createParser(config: ParserConfig): GenericParser {
  function parseLine(line: string, startLine = 1): StatementNode {
    const tokens = scan(line);
    const firstToken = tokens.find((token) => !isIgnorable(token));

    return withParserErrorContext(startLine, firstToken, () => {
      const commandIndex = tokens.findIndex((token) => !isIgnorable(token));
      if (commandIndex < 0) {
        throw createParserError("A command must start with an identifier", startLine);
      }

      const commandToken = tokens[commandIndex];
      if (commandToken?.type !== "identifier") {
        throw createParserError("A command must start with an identifier", startLine, commandToken);
      }

      const name = commandToken.value;
      const commandDefinition = resolveCommandDefinition(config, name);
      const remainder = trimIgnorableEdges(tokens.slice(commandIndex + 1));
      const compactRemainder = compactTokens(remainder);

      if (config.allowAssignmentStatements && compactRemainder[0]?.type === "operator" && compactRemainder[0].value === "=") {
        const value = parseExpressionFromTokens(compactRemainder.slice(1), config, startLine);
        return {
          kind: "assignment",
          name,
          value,
          raw: line
        };
      }

      const args = commandDefinition.arguments.length > 0
        ? parseCommandArgumentsByDefinition(remainder, config, commandDefinition, startLine)
        : commandDefinition.consumeRestAsSingleArgument
          ? remainder.length > 0
            ? { arg0: parseArgumentValue(remainder, config, commandDefinition, startLine) }
            : {}
          : Object.fromEntries(
            splitArguments(remainder).map((tokensForArg, index) => [
              `arg${index}`,
              parseArgumentValue(tokensForArg, config, commandDefinition, startLine)
            ])
          );

      return {
        kind: "command",
        name,
        args,
        raw: line
      };
    });
  }

  function parseScript(input: string): StatementNode[] {
    return splitLogicalLinesWithMetadata(input).map((line) => parseLine(line.content, line.startLine));
  }

  return {
    parseLine,
    parseScript
  };
}

export function extractNestedBlock(source: string, fromIndex = 0): {
  content: string;
  openIndex: number;
  closeIndex: number;
} {
  const openIndex = source.indexOf("{", fromIndex);
  if (openIndex < 0) {
    throw new Error("Missing '{' for nested block");
  }

  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          content: source.slice(openIndex + 1, i).trim(),
          openIndex,
          closeIndex: i
        };
      }
    }
  }

  throw new Error("Unterminated nested block");
}

export function getCommandArgumentSource(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return "";
  }

  let i = 0;
  while (i < trimmed.length && /\S/.test(trimmed[i] ?? "")) {
    i += 1;
  }

  while (i < trimmed.length && /\s/.test(trimmed[i] ?? "")) {
    i += 1;
  }

  return trimmed.slice(i);
}

*/
