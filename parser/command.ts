import { scan, splitLogicalLinesWithMetadata, type Token } from "../scanner/index.js";
import {
  applyExpressionOperatorOverrides,
  compactTokens,
  createParserError,
  isIgnorable,
  parseExpressionFromTokens,
  withParserErrorContext,
  type ExpressionNode,
  type ExpressionOperatorOverrides,
  type ExpressionParserConfig,
  type InfixOperatorDefinition,
  type PrefixOperatorDefinition
} from "./expression.js";
import { toParserConfig, type Language } from "./language.js";

export interface NestedBlockNode {
  kind: "nested-block";
  content: string;
  scope?: Language;
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
  expressionOperators?: ExpressionOperatorOverrides;
  nestedScope?: Language;
}

export class ArgumentInfo {
  readonly name: string;
  readonly kind: ArgumentKind;
  readonly positional: boolean;
  readonly optional: boolean;
  readonly vararg: boolean;
  readonly expressionOperators?: ExpressionOperatorOverrides;
  readonly nestedScope?: Language;

  constructor(definition: CommandArgumentDefinition) {
    this.name = definition.name;
    this.kind = definition.kind;
    this.positional = definition.positional ?? false;
    this.optional = definition.optional ?? false;
    this.vararg = definition.vararg ?? false;
    this.expressionOperators = definition.expressionOperators;
    this.nestedScope = definition.nestedScope;
  }

  static fromDefinitions(definitions: CommandArgumentDefinition[]): ArgumentInfo[] {
    return definitions.map((definition) => new ArgumentInfo(definition));
  }

  static validateOrdering(definitions: ArgumentInfo[]): void {
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index]!;
      if (definition.vararg && (!definition.positional || index !== definitions.length - 1)) {
        throw new Error(`Vararg argument '${definition.name}' must be the last positional argument`);
      }
    }
  }

  static remainingNamedStopNames(definitions: ArgumentInfo[], fromIndex: number): string[] {
    return definitions
      .slice(fromIndex + 1)
      .filter((definition) => definition.isNamed())
      .map((definition) => definition.name);
  }

  isNamed(): boolean {
    return !this.positional;
  }

  isNestedBlock(): boolean {
    return this.kind === "nested-block";
  }

  buildValueCommandDefinition(commandDefinition: Required<CommandDefinition>): Required<CommandDefinition> {
    return {
      ...commandDefinition,
      argumentKind: this.kind,
      consumeRestAsSingleArgument: true,
      parseNamedArguments: false
    };
  }
}

export interface ParserConfig extends ExpressionParserConfig {
  allowAssignmentStatements?: boolean;
  commands?: Record<string, CommandDefinition>;
  strictCommands?: boolean;
  defaultCommand?: CommandDefinition;
}

export interface GenericParser {
  parseLine(line: string, startLine?: number, scope?: Language): StatementNode;
  parseScript(input: string, scope?: Language): StatementNode[];
}

interface ResolvedParserScope {
  prefixOperators: Record<string, PrefixOperatorDefinition>;
  infixOperators: Record<string, InfixOperatorDefinition>;
  allowAssignmentStatements: boolean;
  commands?: Record<string, CommandDefinition>;
  strictCommands: boolean;
  defaultCommand?: CommandDefinition;
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

function resolveScopeFromConfig(config: ParserConfig): ResolvedParserScope {
  return {
    prefixOperators: { ...config.prefixOperators },
    infixOperators: { ...config.infixOperators },
    allowAssignmentStatements: config.allowAssignmentStatements ?? false,
    commands: config.commands,
    strictCommands: config.strictCommands ?? false,
    defaultCommand: config.defaultCommand
  };
}

function mergeScope(base: ResolvedParserScope, override?: Language): ResolvedParserScope {
  if (!override) {
    return base;
  }

  return resolveScopeFromConfig(toParserConfig(override));
}

function toParserScope(scope: ResolvedParserScope): Language {
  return {
    operatorSet: {
      prefixOperators: scope.prefixOperators,
      infixOperators: scope.infixOperators
    },
    commandSet: {
      commands: scope.commands ?? {},
      strictCommands: scope.strictCommands,
      defaultCommand: scope.defaultCommand
    },
    allowAssignmentStatements: scope.allowAssignmentStatements,
  };
}

function resolveCommandDefinition(scope: ResolvedParserScope, commandName: string): Required<CommandDefinition> {
  const commandDefinition = scope.commands?.[commandName];

  if (!commandDefinition && scope.strictCommands) {
    throw new Error(`Unknown command '${commandName}'`);
  }

  return normalizeCommandDefinition(commandDefinition ?? scope.defaultCommand);
}

function parseArgumentValue(
  tokens: Token[],
  expressionConfig: ExpressionParserConfig,
  commandDefinition: Required<CommandDefinition>,
  lineOffset = 1,
  argumentDefinition?: ArgumentInfo,
  nestedScope?: Language
): ArgumentValue {
  if (commandDefinition.argumentKind === "nested-block") {
    const text = tokens.map((token) => token.value).join("");
    const block = extractNestedBlock(text);
    const trailing = text.slice(block.closeIndex + 1).trim();
    if (trailing.length > 0) {
      throw new Error("Unexpected content after nested block");
    }
    return {
      kind: "nested-block",
      content: block.content,
      scope: nestedScope ?? argumentDefinition?.nestedScope
    };
  }

  if (commandDefinition.argumentKind === "raw") {
    return tokens.map((token) => token.value).join("");
  }

  const compact = compactTokens(tokens);
  if (compact.length === 0) {
    throw new Error("Expected expression");
  }

  const effectiveExpressionConfig = applyExpressionOperatorOverrides(expressionConfig, argumentDefinition?.expressionOperators);

  if (
    commandDefinition.parseNamedArguments &&
    compact.length >= 2 &&
    compact[0]?.type === "identifier" &&
    !((compact[1]?.type === "operator" && compact[1]?.value === "=") || compact[1]?.type === "delimiter")
  ) {
    return parseExpressionFromTokens(compact.slice(1), effectiveExpressionConfig, lineOffset);
  }

  return parseExpressionFromTokens(compact, effectiveExpressionConfig, lineOffset);
}

function skipIgnorableTokens(tokens: Token[], from: number): number {
  let cursor = from;
  while (cursor < tokens.length && isIgnorable(tokens[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

function findValueEndForDefinition(tokens: Token[], from: number, stopNames: string[]): number {
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

function parseNestedBlockValue(tokens: Token[], from: number, scope?: Language): { value: NestedBlockNode; next: number } {
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
          value: { kind: "nested-block", content, scope },
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
  definition: ArgumentInfo,
  stopNames: string[],
  expressionConfig: ExpressionParserConfig,
  commandDefinition: Required<CommandDefinition>,
  activeScope: ResolvedParserScope,
  lineOffset = 1
): { value: ArgumentValue; next: number } {
  if (definition.isNestedBlock()) {
    const nestedScope = definition.nestedScope ?? toParserScope(activeScope);
    const parsed = parseNestedBlockValue(tokens, from, nestedScope);
    return { value: parsed.value, next: parsed.next };
  }

  const start = skipIgnorableTokens(tokens, from);
  const end = findValueEndForDefinition(tokens, start, stopNames);
  const segment = tokens.slice(start, end);

  const value = parseArgumentValue(
    segment,
    expressionConfig,
    definition.buildValueCommandDefinition(commandDefinition),
    lineOffset,
    definition
  );

  return { value, next: end };
}

function parseCommandArgumentsByDefinition(
  tokens: Token[],
  expressionConfig: ExpressionParserConfig,
  commandDefinition: Required<CommandDefinition>,
  activeScope: ResolvedParserScope,
  lineOffset = 1
): CommandArguments {
  const args: CommandArguments = {};
  const definitions = ArgumentInfo.fromDefinitions(commandDefinition.arguments);
  ArgumentInfo.validateOrdering(definitions);
  let cursor = 0;

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index]!;

    cursor = skipIgnorableTokens(tokens, cursor);

    if (definition.isNamed()) {
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

    const remainingNamedStops = ArgumentInfo.remainingNamedStopNames(definitions, index);

    if (definition.vararg) {
      const values: ArgumentValue[] = [];
      let varargCursor = skipIgnorableTokens(tokens, cursor);

      if (definition.isNestedBlock()) {
        while (varargCursor < tokens.length) {
          let parsed;
          try {
            parsed = parseValueByKind(
              tokens,
              varargCursor,
              definition,
              [],
              expressionConfig,
              commandDefinition,
              activeScope,
              lineOffset
            );
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
            parsedValue = parseArgumentValue(
              segment,
              expressionConfig,
              definition.buildValueCommandDefinition(commandDefinition),
              lineOffset,
              definition
            );
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
      parsed = parseValueByKind(
        tokens,
        cursor,
        definition,
        remainingNamedStops,
        expressionConfig,
        commandDefinition,
        activeScope,
        lineOffset
      );
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

export function createParser(config: ParserConfig): GenericParser {
  const baseScope = resolveScopeFromConfig(config);

  function parseLine(line: string, startLine = 1, scope?: Language): StatementNode {
    const tokens = scan(line);
    const firstToken = tokens.find((token) => !isIgnorable(token));

    return withParserErrorContext(startLine, firstToken, () => {
      const activeScope = mergeScope(baseScope, scope);
      const expressionConfig: ExpressionParserConfig = {
        prefixOperators: activeScope.prefixOperators,
        infixOperators: activeScope.infixOperators
      };

      const commandIndex = tokens.findIndex((token) => !isIgnorable(token));
      if (commandIndex < 0) {
        throw createParserError("A command must start with an identifier", startLine);
      }

      const commandToken = tokens[commandIndex];
      if (commandToken?.type !== "identifier") {
        throw createParserError("A command must start with an identifier", startLine, commandToken);
      }

      const name = commandToken.value;
      const commandDefinition = resolveCommandDefinition(activeScope, name);
      const remainder = trimIgnorableEdges(tokens.slice(commandIndex + 1));
      const compactRemainder = compactTokens(remainder);

      if (activeScope.allowAssignmentStatements && compactRemainder[0]?.type === "operator" && compactRemainder[0].value === "=") {
        const value = parseExpressionFromTokens(compactRemainder.slice(1), expressionConfig, startLine);
        return {
          kind: "assignment",
          name,
          value,
          raw: line
        };
      }

      const args = commandDefinition.arguments.length > 0
        ? parseCommandArgumentsByDefinition(remainder, expressionConfig, commandDefinition, activeScope, startLine)
        : commandDefinition.consumeRestAsSingleArgument
          ? remainder.length > 0
            ? { arg0: parseArgumentValue(remainder, expressionConfig, commandDefinition, startLine) }
            : {}
          : Object.fromEntries(
            splitArguments(remainder).map((tokensForArg, index) => [
              `arg${index}`,
              parseArgumentValue(tokensForArg, expressionConfig, commandDefinition, startLine)
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

  function parseScript(input: string, scope?: Language): StatementNode[] {
    return splitLogicalLinesWithMetadata(input).map((line) => parseLine(line.content, line.startLine, scope));
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
