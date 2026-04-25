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
}

export type ArgumentValue = ExpressionNode | string | NestedBlockNode;
export type StatementArguments = Record<string, ArgumentValue | ArgumentValue[]>;
export type StatementBlocks = Record<string, NestedBlockNode | NestedBlockNode[]>;

export interface NamedStatementNode {
  kind: "statement";
  name: string;
  args: StatementArguments;
  blocks: StatementBlocks;
  raw: string;
}

export interface AssignmentStatementNode {
  kind: "assignment";
  name: string;
  value: ExpressionNode;
  raw: string;
}

export type StatementNode = NamedStatementNode | AssignmentStatementNode;

export type StatementArgumentKind = "expression" | "raw";

export interface StatementDefinition {
  parts?: StatementPartDefinition[];
  allowExtraArguments?: boolean;
  argumentKind?: StatementArgumentKind;
  parseNamedArguments?: boolean;
  consumeRestAsSingleArgument?: boolean;
}

export interface StatementArgumentDefinition {
  kind: "argument";
  name: string;
  valueKind: StatementArgumentKind;
  positional?: boolean;
  optional?: boolean;
  vararg?: boolean;
  expressionOperators?: ExpressionOperatorOverrides;
}

export interface StatementBlockDefinition {
  kind: "block";
  name: string;
  positional?: boolean;
  optional?: boolean;
  vararg?: boolean;
}

export type StatementPartDefinition = StatementArgumentDefinition | StatementBlockDefinition;

export class PartInfo {
  readonly kind: StatementPartDefinition["kind"];
  readonly name: string;
  readonly positional: boolean;
  readonly optional: boolean;
  readonly vararg: boolean;
  readonly valueKind?: StatementArgumentKind;
  readonly expressionOperators?: ExpressionOperatorOverrides;

  constructor(definition: StatementPartDefinition) {
    this.kind = definition.kind;
    this.name = definition.name;
    this.positional = definition.positional ?? false;
    this.optional = definition.optional ?? false;
    this.vararg = definition.vararg ?? false;
    this.valueKind = definition.kind === "argument" ? definition.valueKind : undefined;
    this.expressionOperators = definition.kind === "argument" ? definition.expressionOperators : undefined;
  }

  static fromDefinitions(definitions: StatementPartDefinition[]): PartInfo[] {
    return definitions.map((definition) => new PartInfo(definition));
  }

  static validateOrdering(definitions: PartInfo[]): void {
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index]!;
      if (definition.vararg && (!definition.positional || index !== definitions.length - 1)) {
        throw new Error(`Vararg part '${definition.name}' must be the last positional part`);
      }
    }
  }

  static remainingNamedStopNames(definitions: PartInfo[], fromIndex: number): string[] {
    return definitions
      .slice(fromIndex + 1)
      .filter((definition) => definition.isNamed())
      .map((definition) => definition.name);
  }

  isNamed(): boolean {
    return !this.positional;
  }

  isBlock(): boolean {
    return this.kind === "block";
  }

  buildValueStatementDefinition(statementDefinition: Required<StatementDefinition>): Required<StatementDefinition> {
    return {
      ...statementDefinition,
      argumentKind: this.valueKind ?? "expression",
      consumeRestAsSingleArgument: true,
      parseNamedArguments: false
    };
  }
}

export interface ParserConfig extends ExpressionParserConfig {
  allowAssignmentStatements?: boolean;
  statements?: Record<string, StatementDefinition>;
  strictStatements?: boolean;
  defaultStatement?: StatementDefinition;
}

export interface GenericParser {
  parseLine(line: string, startLine?: number, scope?: Language): StatementNode;
  parseScript(input: string, scope?: Language): StatementNode[];
}

interface ResolvedParserScope {
  prefixOperators: Record<string, PrefixOperatorDefinition>;
  infixOperators: Record<string, InfixOperatorDefinition>;
  allowAssignmentStatements: boolean;
  statements?: Record<string, StatementDefinition>;
  strictStatements: boolean;
  defaultStatement?: StatementDefinition;
}

function normalizeStatementDefinition(definition?: StatementDefinition): Required<StatementDefinition> {
  return {
    parts: definition?.parts ?? [],
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
    statements: config.statements,
    strictStatements: config.strictStatements ?? false,
    defaultStatement: config.defaultStatement
  };
}

function mergeScope(base: ResolvedParserScope, override?: Language): ResolvedParserScope {
  if (!override) {
    return base;
  }

  return resolveScopeFromConfig(toParserConfig(override));
}

function resolveStatementDefinition(scope: ResolvedParserScope, statementName: string): Required<StatementDefinition> {
  const statementDefinition = scope.statements?.[statementName];

  if (!statementDefinition && scope.strictStatements) {
    throw new Error(`Unknown statement '${statementName}'`);
  }

  return normalizeStatementDefinition(statementDefinition ?? scope.defaultStatement);
}

function parseArgumentValue(
  tokens: Token[],
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  lineOffset = 1,
  partDefinition?: PartInfo
): ArgumentValue {
  if (statementDefinition.argumentKind === "raw") {
    return tokens.map((token) => token.value).join("");
  }

  const compact = compactTokens(tokens);
  if (compact.length === 0) {
    throw new Error("Expected expression");
  }

  const effectiveExpressionConfig = applyExpressionOperatorOverrides(expressionConfig, partDefinition?.expressionOperators);

  if (
    statementDefinition.parseNamedArguments &&
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
          value: { kind: "nested-block", content: content.trim() },
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
  definition: PartInfo,
  stopNames: string[],
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  lineOffset = 1
): { value: ArgumentValue; next: number } {
  if (definition.isBlock()) {
    const parsed = parseNestedBlockValue(tokens, from);
    return { value: parsed.value, next: parsed.next };
  }

  const start = skipIgnorableTokens(tokens, from);
  const end = findValueEndForDefinition(tokens, start, stopNames);
  const segment = tokens.slice(start, end);

  const value = parseArgumentValue(
    segment,
    expressionConfig,
    definition.buildValueStatementDefinition(statementDefinition),
    lineOffset,
    definition
  );

  return { value, next: end };
}

function assignParsedValue(
  args: StatementArguments,
  blocks: StatementBlocks,
  definition: PartInfo,
  value: ArgumentValue | ArgumentValue[]
): void {
  if (!definition.isBlock()) {
    args[definition.name] = value;
    return;
  }

  if (Array.isArray(value)) {
    blocks[definition.name] = value as NestedBlockNode[];
    return;
  }

  blocks[definition.name] = value as NestedBlockNode;
}

function parseStatementValuesByDefinition(
  tokens: Token[],
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  lineOffset = 1
): { args: StatementArguments; blocks: StatementBlocks } {
  const args: StatementArguments = {};
  const blocks: StatementBlocks = {};
  const definitions = PartInfo.fromDefinitions(statementDefinition.parts);
  PartInfo.validateOrdering(definitions);
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

    const remainingNamedStops = PartInfo.remainingNamedStopNames(definitions, index);

    if (definition.vararg) {
      const values: ArgumentValue[] = [];
      let varargCursor = skipIgnorableTokens(tokens, cursor);

      if (definition.isBlock()) {
        while (varargCursor < tokens.length) {
          let parsed;
          try {
            parsed = parseValueByKind(
              tokens,
              varargCursor,
              definition,
              [],
              expressionConfig,
              statementDefinition,
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
              definition.buildValueStatementDefinition(statementDefinition),
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

      assignParsedValue(args, blocks, definition, values);
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
        statementDefinition,
        lineOffset
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid value for argument '${definition.name}': ${message}`);
    }
    assignParsedValue(args, blocks, definition, parsed.value);
    cursor = parsed.next;
  }

  cursor = skipIgnorableTokens(tokens, cursor);
  if (!statementDefinition.allowExtraArguments && cursor < tokens.length) {
    throw new Error("Unexpected extra arguments");
  }

  return { args, blocks };
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

      const statementIndex = tokens.findIndex((token) => !isIgnorable(token));
      if (statementIndex < 0) {
        throw createParserError("A statement must start with an identifier", startLine);
      }

      const statementToken = tokens[statementIndex];
      if (statementToken?.type !== "identifier") {
        throw createParserError("A statement must start with an identifier", startLine, statementToken);
      }

      const name = statementToken.value;
      const statementDefinition = resolveStatementDefinition(activeScope, name);
      const remainder = trimIgnorableEdges(tokens.slice(statementIndex + 1));
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

      let args: StatementArguments = {};
      let blocks: StatementBlocks = {};

      if (statementDefinition.parts.length > 0) {
        const parsed = parseStatementValuesByDefinition(remainder, expressionConfig, statementDefinition, startLine);
        args = parsed.args;
        blocks = parsed.blocks;
      } else if (statementDefinition.consumeRestAsSingleArgument) {
        if (remainder.length > 0) {
          args.arg0 = parseArgumentValue(remainder, expressionConfig, statementDefinition, startLine);
        }
      } else {
        args = Object.fromEntries(
          splitArguments(remainder).map((tokensForArg, index) => [
            `arg${index}`,
            parseArgumentValue(tokensForArg, expressionConfig, statementDefinition, startLine)
          ])
        );
      }

      return {
        kind: "statement",
        name,
        args,
        blocks,
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

export function getStatementArgumentSource(line: string): string {
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
