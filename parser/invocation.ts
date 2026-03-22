import type { Token } from "../scanner/index.js";
import { isIgnorable } from "./expression.js";
import type { ArgDeclGroup, CommandDeclaration, ParsedArguments, ParsedCommand } from "./declaration.js";

interface ClauseParseState {
  parsed: ParsedArguments;
  positionalIndex: number;
  postVarargValues: string[];
}

interface InvocationSegment {
  tokens: Token[];
  value: string;
}

function splitInvocationSegments(tokens: Token[]): InvocationSegment[] {
  const segments: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (token.value === "(" || token.value === "[" || token.value === "{") depth += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);

    if (depth === 0 && isIgnorable(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    if (!isIgnorable(token)) {
      current.push(token);
    }
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

function assignPositionalValue(group: ArgDeclGroup, state: ClauseParseState, value: string): boolean {
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

function parseClause(
  group: ArgDeclGroup,
  clauseName: string,
  segments: InvocationSegment[],
  startIndex: number,
  globalKeywords: Set<string>
): { parsed: ParsedArguments; nextIndex: number } {
  const state = createClauseState(clauseName);
  let index = startIndex;

  while (index < segments.length) {
    const segment = segments[index]!;

    if (isKeywordCandidate(segment, globalKeywords)) {
      const keyword = segmentIdentifierValue(segment)!;
      const childDecl = findChildClause(group, keyword);
      if (!childDecl) {
        break;
      }

      const child = parseClause(childDecl.argDecls, childDecl.keyword, segments, index + 1, globalKeywords);
      if (!state.parsed.clauses[childDecl.keyword]) {
        state.parsed.clauses[childDecl.keyword] = [];
      }
      state.parsed.clauses[childDecl.keyword]!.push(child.parsed);
      index = child.nextIndex;
      continue;
    }

    const consumed = assignPositionalValue(group, state, segment.value);
    if (!consumed) {
      break;
    }
    index += 1;
  }

  finalizeClause(group, state);
  return { parsed: state.parsed, nextIndex: index };
}

export function parseInvocation(tokens: Token[], decl: CommandDeclaration): ParsedCommand {
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

  const commandNameSegment = segments[index];
  const commandName = commandNameSegment ? segmentIdentifierValue(commandNameSegment) : undefined;
  if (!commandName) {
    throw new Error("Expected command name in invocation");
  }
  if (commandName !== decl.name) {
    throw new Error(`Expected command '${decl.name}' but found '${commandName}'`);
  }
  index += 1;

  const root = parseClause(decl.argDecls, decl.name, segments, index, decl.globalKeywords);

  if (root.nextIndex < segments.length) {
    const segment = segments[root.nextIndex]!;
    const identifier = segmentIdentifierValue(segment);
    if (identifier && decl.globalKeywords.has(identifier)) {
      throw new Error(`Keyword '${identifier}' is not valid in this context`);
    }
    throw new Error(`Too many positional arguments in invocation of '${decl.name}'`);
  }

  return {
    commandName: decl.name,
    qualifiers,
    arguments: root.parsed
  };
}

export function validateInvocation(result: ParsedCommand, decl: CommandDeclaration): void {
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

      for (const child of occurrences) {
        validateParsedArguments(clause.argDecls, child);
      }
    }
  }

  if (result.commandName !== decl.name) {
    throw new Error(`Expected command '${decl.name}' but found '${result.commandName}'`);
  }

  validateParsedArguments(decl.argDecls, result.arguments);
}
