import { scan, splitLogicalLinesWithMetadata, type Token } from "../scanner/index.js";
import {
  applyExpressionOperatorOverrides,
  compactTokens,
  createParserError,
  isIgnorable,
  parseExpressionFromTokens,
  withParserErrorContext,
  ExpressionParserConfig,
  type ExpressionNode,
  type ExpressionOperatorOverrides,
  type InfixOperatorDefinition,
  type PrefixOperatorDefinition
} from "./expression.js";
import { toParserConfig, type Language } from "./language.js";

export class NestedBlockNode {
  readonly kind = "nested-block";

  constructor(readonly content: string) {}
}

export type ArgumentValue = ExpressionNode | string | NestedBlockNode;
export type StatementArguments = Record<string, ArgumentValue | ArgumentValue[]>;
export type StatementBlocks = Record<string, NestedBlockNode | NestedBlockNode[]>;
export type StatementClauses = Record<string, ParsedStatementClause[]>;

export class ParsedStatementClause {
  constructor(
    readonly args: StatementArguments,
    readonly blocks: StatementBlocks,
    readonly clauses: StatementClauses
  ) {}
}

export class NamedStatementNode {
  readonly kind = "statement";

  constructor(
    readonly name: string,
    readonly args: StatementArguments,
    readonly blocks: StatementBlocks,
    readonly raw: string,
    readonly qualifiers?: Record<string, boolean>,
    readonly clauses?: StatementClauses
  ) {}
}

export class AssignmentStatementNode {
  readonly kind = "assignment";

  constructor(
    readonly name: string,
    readonly value: ExpressionNode,
    readonly raw: string
  ) {}
}

export type StatementNode = NamedStatementNode | AssignmentStatementNode;

export type StatementArgumentKind = "expression" | "raw";

export class StatementDefinition {
  parts?: StatementPartDefinition[];
  qualifiers?: StatementQualifierDefinition[];
  allowExtraArguments?: boolean;
  argumentKind?: StatementArgumentKind;
  parseNamedArguments?: boolean;
  consumeRestAsSingleArgument?: boolean;
  argumentExpressionOperators?: ExpressionOperatorOverrides;

  constructor(definition: StatementDefinition = {}) {
    Object.assign(this, definition);
  }
}

export class StatementQualifierDefinition {
  constructor(readonly keyword: string) {}
}

export class StatementArgumentDefinition {
  readonly kind = "argument";
  name!: string;
  valueKind!: StatementArgumentKind;
  positional?: boolean;
  optional?: boolean;
  vararg?: boolean;
  trailingNamedArguments?: string[];
  expressionOperators?: ExpressionOperatorOverrides;

  constructor(definition: Omit<StatementArgumentDefinition, "kind">) {
    Object.assign(this, definition);
  }
}

export class StatementBlockDefinition {
  readonly kind = "block";
  name!: string;
  positional?: boolean;
  optional?: boolean;
  vararg?: boolean;
  languageName?: string;

  constructor(definition: Omit<StatementBlockDefinition, "kind">) {
    Object.assign(this, definition);
  }
}

export class StatementClauseBlockDefinition {
  constructor(readonly languageName?: string) {}
}

export class StatementClauseDefinition {
  readonly kind = "clause";
  name!: string;
  optional?: boolean;
  vararg?: boolean;
  parts?: StatementPartDefinition[];
  block?: StatementClauseBlockDefinition;

  constructor(definition: Omit<StatementClauseDefinition, "kind">) {
    Object.assign(this, definition);
  }
}

export type StatementPartDefinition = StatementArgumentDefinition | StatementBlockDefinition | StatementClauseDefinition;

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
    this.positional = definition.kind === "clause" ? false : definition.positional ?? false;
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
      if (definition.kind !== "clause" && definition.vararg && (!definition.positional || index !== definitions.length - 1)) {
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

export class ParserConfig extends ExpressionParserConfig {
  allowAssignmentStatements?: boolean;
  statements?: Record<string, StatementDefinition>;
  strictStatements?: boolean;
  defaultStatement?: StatementDefinition;

  constructor(config: ParserConfig) {
    super(config.prefixOperators, config.infixOperators);
    this.allowAssignmentStatements = config.allowAssignmentStatements;
    this.statements = config.statements;
    this.strictStatements = config.strictStatements;
    this.defaultStatement = config.defaultStatement;
  }
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
    qualifiers: definition?.qualifiers ?? [],
    allowExtraArguments: definition?.allowExtraArguments ?? false,
    argumentKind: definition?.argumentKind ?? "expression",
    parseNamedArguments: definition?.parseNamedArguments ?? true,
    consumeRestAsSingleArgument: definition?.consumeRestAsSingleArgument ?? false,
    argumentExpressionOperators: definition?.argumentExpressionOperators ?? {}
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

  const statementExpressionConfig = applyExpressionOperatorOverrides(
    expressionConfig,
    statementDefinition.argumentExpressionOperators
  );
  const effectiveExpressionConfig = applyExpressionOperatorOverrides(statementExpressionConfig, partDefinition?.expressionOperators);

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
          value: new NestedBlockNode(content.trim()),
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

interface StatementSegment {
  tokens: Token[];
  value: string;
  startTokenIndex: number;
  endTokenIndex: number;
}

interface RichParseResult {
  args: StatementArguments;
  blocks: StatementBlocks;
  clauses: StatementClauses;
  nextIndex: number;
}

function statementUsesRichParts(definition: Required<StatementDefinition>): boolean {
  return definition.qualifiers.length > 0 || definition.parts.some((part) =>
    part.kind === "clause" ||
    (part.kind === "argument" && (part.trailingNamedArguments?.length ?? 0) > 0)
  );
}

function splitStatementSegments(tokens: Token[]): StatementSegment[] {
  const segments: StatementSegment[] = [];
  let current: Token[] = [];
  let currentStart = 0;
  let depth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const wasTopLevel = depth === 0;

    if (token.value === "(" || token.value === "[" || token.value === "{") depth += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);

    if (wasTopLevel && isIgnorable(token)) {
      if (current.length > 0) {
        segments.push({
          tokens: current,
          value: current.map((entry) => entry.value).join(""),
          startTokenIndex: currentStart,
          endTokenIndex: index
        });
        current = [];
      }
      continue;
    }

    if (current.length === 0) {
      currentStart = index;
    }
    current.push(token);
  }

  if (current.length > 0) {
    segments.push({
      tokens: current,
      value: current.map((entry) => entry.value).join(""),
      startTokenIndex: currentStart,
      endTokenIndex: tokens.length
    });
  }

  return segments;
}

function segmentIdentifier(segment: StatementSegment | undefined): string | undefined {
  if (!segment || segment.tokens.length !== 1) {
    return undefined;
  }

  const token = segment.tokens[0]!;
  return token.type === "identifier" ? token.value : undefined;
}

function isBlockSegment(segment: StatementSegment | undefined): boolean {
  return segment?.tokens[0]?.value === "{";
}

function flattenSegments(segments: StatementSegment[], start: number, end: number): Token[] {
  return segments.slice(start, end).flatMap((segment) => segment.tokens);
}

function clauseParts(parts: StatementPartDefinition[]): StatementClauseDefinition[] {
  return parts.filter((part): part is StatementClauseDefinition => part.kind === "clause");
}

function clauseStopNames(parts: StatementPartDefinition[], inherited: string[]): string[] {
  return [...new Set([...clauseParts(parts).map((part) => part.name), ...inherited])];
}

function findSegmentStopIndex(
  segments: StatementSegment[],
  fromIndex: number,
  stopNames: string[],
  stopAtBlock = false
): number {
  for (let index = fromIndex; index < segments.length; index += 1) {
    if (stopAtBlock && isBlockSegment(segments[index])) {
      return index;
    }

    const identifier = segmentIdentifier(segments[index]);
    if (identifier && stopNames.includes(identifier)) {
      return index;
    }
  }

  return segments.length;
}

function parseArgumentFromSegments(
  segments: StatementSegment[],
  startIndex: number,
  endIndex: number,
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  partDefinition: PartInfo,
  lineOffset: number
): ArgumentValue {
  return parseArgumentValue(
    flattenSegments(segments, startIndex, endIndex),
    expressionConfig,
    statementDefinition,
    lineOffset,
    partDefinition
  );
}

function parseRichValuePart(
  part: StatementArgumentDefinition | StatementBlockDefinition,
  segments: StatementSegment[],
  index: number,
  stopNames: string[],
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  lineOffset: number,
  consumeOneSegment = false,
  stopAtBlock = false
): { value: ArgumentValue; nextIndex: number } {
  const partInfo = new PartInfo(part);

  if (!part.positional) {
    const keyword = segmentIdentifier(segments[index]);
    if (keyword !== part.name) {
      if (part.optional) {
        return { value: undefined as unknown as ArgumentValue, nextIndex: index };
      }
      throw new Error(`Missing required named argument '${part.name}'`);
    }
    index += 1;
  }

  if (part.kind === "block") {
    const segment = segments[index];
    if (!isBlockSegment(segment)) {
      if (part.optional) {
        return { value: undefined as unknown as ArgumentValue, nextIndex: index };
      }
      throw new Error(`Invalid value for argument '${part.name}': Expected nested block starting with '{'`);
    }

    return {
      value: parseNestedBlockValue(segment!.tokens, 0).value,
      nextIndex: index + 1
    };
  }

  const valueEnd = findSegmentStopIndex(segments, index, stopNames, stopAtBlock);
  if (valueEnd <= index) {
    if (part.optional) {
      return { value: undefined as unknown as ArgumentValue, nextIndex: index };
    }
    throw new Error(`Missing required argument '${part.name}'`);
  }

  const nextIndex = consumeOneSegment ? index + 1 : valueEnd;

  return {
    value: parseArgumentFromSegments(
      segments,
      index,
      nextIndex,
      expressionConfig,
      statementDefinition,
      partInfo,
      lineOffset
    ),
    nextIndex
  };
}

function addClause(target: StatementClauses, name: string, clause: ParsedStatementClause): void {
  if (!target[name]) {
    target[name] = [];
  }
  target[name]!.push(clause);
}

function assignRichPartValue(
  args: StatementArguments,
  blocks: StatementBlocks,
  part: StatementArgumentDefinition | StatementBlockDefinition,
  value: ArgumentValue | ArgumentValue[] | undefined
): void {
  if (value === undefined) {
    return;
  }

  if (part.kind === "block") {
    blocks[part.name] = value as NestedBlockNode | NestedBlockNode[];
    return;
  }

  args[part.name] = value;
}

function parseVarargValues(
  part: StatementArgumentDefinition,
  segments: StatementSegment[],
  index: number,
  stopNames: string[],
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  lineOffset: number
): { argsValue: ArgumentValue[]; trailing: Record<string, ArgumentValue>; nextIndex: number } {
  const endIndex = findSegmentStopIndex(segments, index, stopNames);
  const partInfo = new PartInfo(part);
  const values: ArgumentValue[] = [];

  for (let cursor = index; cursor < endIndex; cursor += 1) {
    values.push(parseArgumentFromSegments(segments, cursor, cursor + 1, expressionConfig, statementDefinition, partInfo, lineOffset));
  }

  const trailingNames = part.trailingNamedArguments ?? [];
  if (values.length < trailingNames.length) {
    const missing = trailingNames[values.length] ?? trailingNames[0] ?? part.name;
    throw new Error(`Missing required trailing positional argument '${missing}'`);
  }

  const varargEnd = values.length - trailingNames.length;
  const trailing: Record<string, ArgumentValue> = {};
  for (let i = 0; i < trailingNames.length; i += 1) {
    trailing[trailingNames[i]!] = values[varargEnd + i]!;
  }

  return {
    argsValue: values.slice(0, varargEnd),
    trailing,
    nextIndex: endIndex
  };
}

function parseRichParts(
  parts: StatementPartDefinition[],
  segments: StatementSegment[],
  startIndex: number,
  inheritedStopNames: string[],
  expressionConfig: ExpressionParserConfig,
  statementDefinition: Required<StatementDefinition>,
  lineOffset: number,
  stopAtBlock = false
): RichParseResult {
  const args: StatementArguments = {};
  const blocks: StatementBlocks = {};
  const clauses: StatementClauses = {};
  const stops = clauseStopNames(parts, inheritedStopNames);
  let index = startIndex;

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]!;
    if (part.kind === "clause") {
      let occurrences = 0;
      while (segmentIdentifier(segments[index]) === part.name) {
        const child = parseRichParts(
          part.parts ?? [],
          segments,
          index + 1,
          stops.filter((name) => name !== part.name),
          expressionConfig,
          statementDefinition,
          lineOffset,
          part.block !== undefined
        );
        index = child.nextIndex;

        const clauseBlock: StatementBlocks = { ...child.blocks };
        if (part.block) {
          const segment = segments[index];
          if (!isBlockSegment(segment)) {
            throw new Error(`Expected nested block after clause '${part.name}'`);
          }
          clauseBlock[part.name] = parseNestedBlockValue(segment!.tokens, 0).value;
          index += 1;
        }

        addClause(clauses, part.name, new ParsedStatementClause(child.args, clauseBlock, child.clauses));

        if (part.block && clauseBlock[part.name]) {
          const existing = blocks[part.name];
          const value = clauseBlock[part.name] as NestedBlockNode;
          blocks[part.name] = existing
            ? [...(Array.isArray(existing) ? existing : [existing]), value]
            : value;
        }

        occurrences += 1;
        if (!part.vararg) {
          break;
        }
      }

      if (!part.optional && occurrences === 0) {
        throw new Error(`Missing required clause '${part.name}'`);
      }
      continue;
    }

    if (part.kind === "argument" && part.vararg) {
      const parsed = parseVarargValues(part, segments, index, stops, expressionConfig, statementDefinition, lineOffset);
      args[part.name] = parsed.argsValue;
      for (const [name, value] of Object.entries(parsed.trailing)) {
        args[name] = value;
      }
      index = parsed.nextIndex;
      continue;
    }

    const before = index;
    const hasLaterValuePart = parts.slice(partIndex + 1).some((candidate) => candidate.kind !== "clause");
    const parsed = parseRichValuePart(part, segments, index, stops, expressionConfig, statementDefinition, lineOffset, hasLaterValuePart, stopAtBlock);
    if (parsed.nextIndex === before && part.optional) {
      continue;
    }
    assignRichPartValue(args, blocks, part, parsed.value);
    index = parsed.nextIndex;
  }

  return {
    args,
    blocks,
    clauses,
    nextIndex: index
  };
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

      const statementSegments = splitStatementSegments(tokens.slice(statementIndex));
      let statementSegmentIndex = 0;
      let name = statementToken.value;
      let statementDefinition = normalizeStatementDefinition(activeScope.statements?.[name] ?? activeScope.defaultStatement);
      const parsedQualifiers: Record<string, boolean> = {};

      if (!activeScope.statements?.[name] && activeScope.statements) {
        for (let index = 1; index < statementSegments.length; index += 1) {
          const candidateName = segmentIdentifier(statementSegments[index]);
          const candidateDefinition = candidateName ? activeScope.statements[candidateName] : undefined;
          if (!candidateName || !candidateDefinition) {
            continue;
          }

          const qualifierNames = new Set((candidateDefinition.qualifiers ?? []).map((qualifier) => qualifier.keyword));
          const prefixSegments = statementSegments.slice(0, index);
          const prefixIsQualifierList = prefixSegments.every((segment) => {
            const identifier = segmentIdentifier(segment);
            return identifier !== undefined && qualifierNames.has(identifier);
          });

          if (prefixIsQualifierList) {
            statementSegmentIndex = index;
            name = candidateName;
            statementDefinition = normalizeStatementDefinition(candidateDefinition);
            for (const segment of prefixSegments) {
              const identifier = segmentIdentifier(segment)!;
              parsedQualifiers[identifier] = true;
            }
            break;
          }
        }
      }

      if (!activeScope.statements?.[name] && activeScope.strictStatements) {
        throw new Error(`Unknown statement '${name}'`);
      }

      for (const qualifier of statementDefinition.qualifiers) {
        if (!(qualifier.keyword in parsedQualifiers)) {
          parsedQualifiers[qualifier.keyword] = false;
        }
      }

      const remainder = trimIgnorableEdges(
        statementSegmentIndex === 0
          ? tokens.slice(statementIndex + 1)
          : tokens.slice(statementIndex + statementSegments[statementSegmentIndex]!.endTokenIndex)
      );
      const compactRemainder = compactTokens(remainder);

      if (statementSegmentIndex === 0 && activeScope.allowAssignmentStatements && compactRemainder[0]?.type === "operator" && compactRemainder[0].value === "=") {
        const value = parseExpressionFromTokens(compactRemainder.slice(1), expressionConfig, startLine);
        return new AssignmentStatementNode(name, value, line);
      }

      let args: StatementArguments = {};
      let blocks: StatementBlocks = {};
      let clauses: StatementClauses | undefined;

      if (statementUsesRichParts(statementDefinition)) {
        const parsed = parseRichParts(
          statementDefinition.parts,
          splitStatementSegments(remainder),
          0,
          [],
          expressionConfig,
          statementDefinition,
          startLine
        );
        args = parsed.args;
        blocks = parsed.blocks;
        clauses = parsed.clauses;
        if (!statementDefinition.allowExtraArguments && parsed.nextIndex < splitStatementSegments(remainder).length) {
          throw new Error("Unexpected extra arguments");
        }
      } else if (statementDefinition.parts.length > 0) {
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

      return new NamedStatementNode(
        name,
        args,
        blocks,
        line,
        Object.keys(parsedQualifiers).length > 0 ? parsedQualifiers : undefined,
        clauses
      );
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
