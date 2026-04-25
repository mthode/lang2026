import type { Token } from "../scanner/index.js";
import { extractNestedBlock, type ArgumentValue, type NestedBlockNode } from "./statement.js";
import {
  isIgnorable,
  parseExpressionFromTokens,
  type ExpressionParserConfig
} from "./expression.js";
import type { ArgDeclGroup, ClauseBlockDecl, ParsedArguments, ParsedStatement, StatementDeclaration } from "./declaration.js";

interface ClauseParseState {
  parsed: ParsedArguments;
  positionalIndex: number;
  postVarargValues: ArgumentValue[];
}

interface InvocationSegment {
  tokens: Token[];
  value: string;
}

type ParsedBlocks = Record<string, NestedBlockNode[]>;

export interface InvocationParseOptions {
  expressionConfig?: ExpressionParserConfig;
}

function splitInvocationSegments(tokens: Token[]): InvocationSegment[] {
  const segments: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const token of tokens) {
    const wasTopLevel = depth === 0;
    if (token.value === "(" || token.value === "[" || token.value === "{") depth += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);

    if (wasTopLevel && isIgnorable(token)) {
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

  return segments.map((segmentTokens) => ({
    tokens: segmentTokens,
    value: segmentTokens.map((token) => token.value).join("")
  }));
}

function segmentIdentifierValue(segment: InvocationSegment): string | undefined {
  if (segment.tokens.length !== 1) {
    return undefined;
  }
  const token = segment.tokens[0]!;
  return token.type === "identifier" ? token.value : undefined;
}

function isKeywordCandidate(segment: InvocationSegment, keywords: Set<string>): boolean {
  const identifier = segmentIdentifierValue(segment);
  return identifier !== undefined && keywords.has(identifier);
}

function isBlockSegment(segment: InvocationSegment): boolean {
  return segment.tokens[0]?.value === "{";
}

function findChildClause(group: ArgDeclGroup, keyword: string) {
  return group.keyedClauses.find((clause) => clause.keyword === keyword);
}

function createClauseState(clauseName: string): ClauseParseState {
  return {
    parsed: {
      clauseName,
      namedArgs: {},
      varArgs: [],
      clauses: {}
    },
    positionalIndex: 0,
    postVarargValues: []
  };
}

function assignPositionalValue(group: ArgDeclGroup, state: ClauseParseState, value: ArgumentValue): boolean {
  if (state.positionalIndex < group.positional.length) {
    const declaration = group.positional[state.positionalIndex]!;
    if (declaration.kind === "named" && declaration.name) {
      state.parsed.namedArgs[declaration.name] = value;
    } else {
      state.parsed.varArgs.push(value);
    }
    state.positionalIndex += 1;
    return true;
  }

  if (group.vararg) {
    state.postVarargValues.push(value);
    return true;
  }

  return false;
}

function flattenSegmentTokens(segments: InvocationSegment[], startIndex: number, endIndex: number): Token[] {
  return segments.slice(startIndex, endIndex).flatMap((segment) => segment.tokens);
}

function findChildClauseBoundaryIndex(
  group: ArgDeclGroup,
  segments: InvocationSegment[],
  fromIndex: number,
  globalKeywords: Set<string>,
  expectsBlock = false
): number {
  for (let index = fromIndex; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (expectsBlock && isBlockSegment(segment)) {
      return index;
    }

    if (!isKeywordCandidate(segment, globalKeywords)) {
      continue;
    }

    const keyword = segmentIdentifierValue(segment)!;
    if (findChildClause(group, keyword)) {
      return index;
    }
  }

  return segments.length;
}

function hasAdditionalValueSlots(group: ArgDeclGroup, state: ClauseParseState): boolean {
  if (state.positionalIndex < group.positional.length - 1) {
    return true;
  }

  return group.vararg !== undefined;
}

function countRequiredValuesAfterCurrent(group: ArgDeclGroup, state: ClauseParseState): number {
  let count = 0;

  if (state.positionalIndex < group.positional.length) {
    for (let index = state.positionalIndex + 1; index < group.positional.length; index += 1) {
      if (!group.positional[index]!.optional) {
        count += 1;
      }
    }
  }

  if (group.vararg) {
    count += group.vararg.trailingNamedArgs.length;
  }

  return count;
}

function canConsumeValue(group: ArgDeclGroup, state: ClauseParseState): boolean {
  return state.positionalIndex < group.positional.length || group.vararg !== undefined;
}

function tryParseExpressionValue(
  tokens: Token[],
  expressionConfig: ExpressionParserConfig
): ArgumentValue | undefined {
  try {
    return parseExpressionFromTokens(tokens, expressionConfig);
  } catch {
    return undefined;
  }
}

function parseExpressionValueForClause(
  group: ArgDeclGroup,
  state: ClauseParseState,
  segments: InvocationSegment[],
  startIndex: number,
  globalKeywords: Set<string>,
  expressionConfig: ExpressionParserConfig,
  expectsBlock = false
): { value: ArgumentValue; nextIndex: number } {
  const valueRegionEnd = findChildClauseBoundaryIndex(group, segments, startIndex, globalKeywords, expectsBlock);
  const requiredAfterCurrent = countRequiredValuesAfterCurrent(group, state);
  const canLeaveAdditionalValues = hasAdditionalValueSlots(group, state);
  const minEnd = canLeaveAdditionalValues ? startIndex + 1 : valueRegionEnd;
  const maxEnd = canLeaveAdditionalValues
    ? Math.max(minEnd, valueRegionEnd - requiredAfterCurrent)
    : valueRegionEnd;

  for (let endIndex = maxEnd; endIndex >= minEnd; endIndex -= 1) {
    if (valueRegionEnd - endIndex < requiredAfterCurrent) {
      continue;
    }

    const parsed = tryParseExpressionValue(flattenSegmentTokens(segments, startIndex, endIndex), expressionConfig);
    if (parsed !== undefined) {
      return { value: parsed, nextIndex: endIndex };
    }
  }

  const fullRangeTokens = flattenSegmentTokens(segments, startIndex, valueRegionEnd);
  return {
    value: parseExpressionFromTokens(fullRangeTokens, expressionConfig),
    nextIndex: valueRegionEnd
  };
}

function finalizeClause(group: ArgDeclGroup, state: ClauseParseState): void {
  for (let i = state.positionalIndex; i < group.positional.length; i += 1) {
    const declaration = group.positional[i]!;
    if (!declaration.optional) {
      const missingName = declaration.kind === "named" && declaration.name ? declaration.name : "_";
      throw new Error(`Missing required positional argument '${missingName}' in clause '${state.parsed.clauseName}'`);
    }
  }

  if (!group.vararg) {
    return;
  }

  const trailingCount = group.vararg.trailingNamedArgs.length;
  if (state.postVarargValues.length < trailingCount) {
    const missing = group.vararg.trailingNamedArgs[state.postVarargValues.length] ?? group.vararg.trailingNamedArgs[0] ?? "_";
    throw new Error(`Missing required trailing positional argument '${missing}' in clause '${state.parsed.clauseName}'`);
  }

  const varargEnd = state.postVarargValues.length - trailingCount;
  for (let i = 0; i < varargEnd; i += 1) {
    state.parsed.varArgs.push(state.postVarargValues[i]!);
  }

  for (let i = 0; i < trailingCount; i += 1) {
    const name = group.vararg.trailingNamedArgs[i]!;
    const value = state.postVarargValues[varargEnd + i]!;
    state.parsed.namedArgs[name] = value;
  }
}

function parseNestedBlockSegment(
  segment: InvocationSegment | undefined,
  clauseName: string
): NestedBlockNode {
  if (!segment || !isBlockSegment(segment)) {
    throw new Error(`Expected nested block after clause '${clauseName}'`);
  }

  const block = extractNestedBlock(segment.value);
  const trailing = segment.value.slice(block.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error(`Unexpected content after nested block for clause '${clauseName}'`);
  }

  return {
    kind: "nested-block",
    content: block.content
  };
}

function addParsedBlock(blocks: ParsedBlocks, name: string, block: NestedBlockNode): void {
  if (!blocks[name]) {
    blocks[name] = [];
  }
  blocks[name]!.push(block);
}

function mergeParsedBlocks(target: ParsedBlocks, source: ParsedBlocks): void {
  for (const [name, blocks] of Object.entries(source)) {
    if (!target[name]) {
      target[name] = [];
    }
    target[name]!.push(...blocks);
  }
}

function parseClause(
  group: ArgDeclGroup,
  clauseName: string,
  segments: InvocationSegment[],
  startIndex: number,
  globalKeywords: Set<string>,
  expressionConfig?: ExpressionParserConfig,
  blockDecl?: ClauseBlockDecl
): { parsed: ParsedArguments; blocks: ParsedBlocks; nextIndex: number } {
  const state = createClauseState(clauseName);
  const blocks: ParsedBlocks = {};
  let index = startIndex;

  while (index < segments.length) {
    const segment = segments[index]!;

    if (isKeywordCandidate(segment, globalKeywords)) {
      const keyword = segmentIdentifierValue(segment)!;
      const childDecl = findChildClause(group, keyword);
      if (!childDecl) {
        break;
      }

      const child = parseClause(
        childDecl.argDecls,
        childDecl.keyword,
        segments,
        index + 1,
        globalKeywords,
        expressionConfig,
        childDecl.block
      );
      if (!state.parsed.clauses[childDecl.keyword]) {
        state.parsed.clauses[childDecl.keyword] = [];
      }
      state.parsed.clauses[childDecl.keyword]!.push(child.parsed);
      mergeParsedBlocks(blocks, child.blocks);

      if (childDecl.block) {
        addParsedBlock(
          blocks,
          childDecl.keyword,
          parseNestedBlockSegment(segments[child.nextIndex], childDecl.keyword)
        );
        index = child.nextIndex + 1;
      } else {
        index = child.nextIndex;
      }
      continue;
    }

    if (!canConsumeValue(group, state)) {
      break;
    }

    if (blockDecl && isBlockSegment(segment)) {
      break;
    }

    const valueResult = expressionConfig
      ? parseExpressionValueForClause(group, state, segments, index, globalKeywords, expressionConfig, blockDecl !== undefined)
      : { value: segment.value, nextIndex: index + 1 };

    const consumed = assignPositionalValue(group, state, valueResult.value);
    if (!consumed) {
      break;
    }
    index = valueResult.nextIndex;
  }

  finalizeClause(group, state);
  return { parsed: state.parsed, blocks, nextIndex: index };
}

export function parseInvocation(
  tokens: Token[],
  decl: StatementDeclaration,
  options: InvocationParseOptions = {}
): ParsedStatement {
  const { expressionConfig } = options;
  const segments = splitInvocationSegments(tokens);
  const qualifiers = Object.fromEntries(decl.qualifiers.map((q) => [q.keyword, false])) as Record<string, boolean>;
  const qualifierSet = new Set(decl.qualifiers.map((q) => q.keyword));

  let index = 0;
  while (index < segments.length) {
    const identifier = segmentIdentifierValue(segments[index]!);
    if (!identifier || !qualifierSet.has(identifier)) {
      break;
    }
    qualifiers[identifier] = true;
    index += 1;
  }

  const statementNameSegment = segments[index];
  const statementName = statementNameSegment ? segmentIdentifierValue(statementNameSegment) : undefined;
  if (!statementName) {
    throw new Error("Expected statement name in invocation");
  }
  if (statementName !== decl.name) {
    throw new Error(`Expected statement '${decl.name}' but found '${statementName}'`);
  }
  index += 1;

  const root = parseClause(decl.argDecls, decl.name, segments, index, decl.globalKeywords, expressionConfig);

  if (root.nextIndex < segments.length) {
    const segment = segments[root.nextIndex]!;
    const identifier = segmentIdentifierValue(segment);
    if (identifier && decl.globalKeywords.has(identifier)) {
      throw new Error(`Keyword '${identifier}' is not valid in this context`);
    }
    throw new Error(`Too many positional arguments in invocation of '${decl.name}'`);
  }

  return {
    statementName: decl.name,
    qualifiers,
    arguments: root.parsed,
    blocks: root.blocks
  };
}

export function validateInvocation(result: ParsedStatement, decl: StatementDeclaration): void {
  const allowedBlockNames = new Set<string>();

  function collectInvocationBlockNames(group: ArgDeclGroup): void {
    for (const clause of group.keyedClauses) {
      if (clause.block) {
        allowedBlockNames.add(clause.keyword);
      }
      collectInvocationBlockNames(clause.argDecls);
    }
  }

  function validateParsedArguments(group: ArgDeclGroup, parsed: ParsedArguments): void {
    // Required positional declarations must be present.
    const requiredNamed = group.positional.filter((p) => !p.optional && p.kind === "named" && p.name).map((p) => p.name as string);
    for (const name of requiredNamed) {
      if (!(name in parsed.namedArgs)) {
        throw new Error(`Missing required positional argument '${name}' in clause '${parsed.clauseName}'`);
      }
    }

    const requiredUnnamedCount = group.positional.filter((p) => !p.optional && p.kind === "unnamed").length;
    if (parsed.varArgs.length < requiredUnnamedCount) {
      throw new Error(`Missing required positional argument '_' in clause '${parsed.clauseName}'`);
    }

    // Clause cardinality checks.
    for (const clause of group.keyedClauses) {
      const occurrences = parsed.clauses[clause.keyword] ?? [];

      if (clause.required && occurrences.length === 0) {
        throw new Error(`Missing required clause '${clause.keyword}' in clause '${parsed.clauseName}'`);
      }

      if (!clause.allowMultiple && occurrences.length > 1) {
        throw new Error(`Clause '${clause.keyword}' may appear at most once in clause '${parsed.clauseName}'`);
      }

      if (clause.required && clause.allowMultiple && occurrences.length < 1) {
        throw new Error(`Clause '${clause.keyword}' must appear at least once in clause '${parsed.clauseName}'`);
      }

      if (clause.block) {
        const blockCount = result.blocks[clause.keyword]?.length ?? 0;
        if (blockCount !== occurrences.length) {
          throw new Error(`Block clause '${clause.keyword}' expected ${occurrences.length} block(s) but found ${blockCount}`);
        }
      }

      for (const child of occurrences) {
        validateParsedArguments(clause.argDecls, child);
      }
    }
  }

  function validateParsedBlocks(): void {
    collectInvocationBlockNames(decl.argDecls);

    for (const name of Object.keys(result.blocks)) {
      if (!allowedBlockNames.has(name)) {
        throw new Error(`Unexpected block section '${name}' in statement '${result.statementName}'`);
      }
    }
  }

  if (result.statementName !== decl.name) {
    throw new Error(`Expected statement '${decl.name}' but found '${result.statementName}'`);
  }

  validateParsedArguments(decl.argDecls, result.arguments);
  validateParsedBlocks();
}
