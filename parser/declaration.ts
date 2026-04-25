import type { Token } from "../scanner/index.js";
import { type ArgumentValue, type NestedBlockNode } from "./statement.js";
import { isIgnorable } from "./expression.js";

export interface PositionalArgDecl {
  kind: "named" | "unnamed";
  name?: string;
  optional: boolean;
}

export interface VarargDecl {
  trailingNamedArgs: string[];
}

export interface ClauseBlockDecl {
  languageName?: string;
}

export interface KeyedClauseDecl {
  keyword: string;
  required: boolean;
  allowMultiple: boolean;
  argDecls: ArgDeclGroup;
  block?: ClauseBlockDecl;
}

export interface QualifierDecl {
  keyword: string;
}

export interface ArgDeclGroup {
  positional: PositionalArgDecl[];
  keyedClauses: KeyedClauseDecl[];
  vararg?: VarargDecl;
}

export interface StatementBlockDecl {
  name: string;
  required: boolean;
  allowMultiple: boolean;
  languageName?: string;
}

export interface StatementDeclaration {
  name: string;
  argumentOperatorSetName?: string;
  qualifiers: QualifierDecl[];
  argDecls: ArgDeclGroup;
  blocks: StatementBlockDecl[];
  globalKeywords: Set<string>;
}

export interface ParsedArguments {
  clauseName: string;
  namedArgs: Record<string, ArgumentValue>;
  varArgs: ArgumentValue[];
  clauses: Record<string, ParsedArguments[]>;
}

export interface ParsedStatement {
  statementName: string;
  qualifiers: Record<string, boolean>;
  arguments: ParsedArguments;
  blocks: Record<string, NestedBlockNode[]>;
}

interface DeclarationParserState {
  tokens: Token[];
  index: number;
}

interface ParsedArgDeclGroup extends ArgDeclGroup {
  block?: ClauseBlockDecl;
}

function isIdentifierToken(token: Token | undefined): token is Token {
  return token?.type === "identifier";
}

function skipIgnorable(state: DeclarationParserState): void {
  while (state.index < state.tokens.length && isIgnorable(state.tokens[state.index]!)) {
    state.index += 1;
  }
}

function peekNonIgnorable(state: DeclarationParserState, lookahead = 0): Token | undefined {
  let cursor = state.index;
  let seen = 0;

  while (cursor < state.tokens.length) {
    const token = state.tokens[cursor]!;
    if (!isIgnorable(token)) {
      if (seen === lookahead) {
        return token;
      }
      seen += 1;
    }
    cursor += 1;
  }

  return undefined;
}

function consumeNonIgnorable(state: DeclarationParserState): Token | undefined {
  skipIgnorable(state);
  const token = state.tokens[state.index];
  if (!token) {
    return undefined;
  }
  state.index += 1;
  return token;
}

function describeToken(token: Token | undefined): string {
  if (!token) {
    return "end of declaration";
  }
  return `'${token.value}'`;
}

function parseEvaluateAnnotation(state: DeclarationParserState): string | undefined {
  const marker = peekNonIgnorable(state);
  const keyword = peekNonIgnorable(state, 1);

  if (marker?.value !== "--" || !isIdentifierToken(keyword) || keyword.value !== "evaluate") {
    return undefined;
  }

  consumeNonIgnorable(state);
  consumeNonIgnorable(state);

  const nameToken = consumeNonIgnorable(state);
  if (!isIdentifierToken(nameToken) || nameToken.value === "_") {
    throw new Error("Expected operator set name after '--evaluate'");
  }

  const repeatedMarker = peekNonIgnorable(state);
  const repeatedKeyword = peekNonIgnorable(state, 1);
  if (repeatedMarker?.value === "--" && isIdentifierToken(repeatedKeyword) && repeatedKeyword.value === "evaluate") {
    throw new Error("Repeated '--evaluate' annotation");
  }

  return nameToken.value;
}

function parseBlockAnnotation(state: DeclarationParserState): string | undefined {
  const marker = peekNonIgnorable(state);
  if (marker?.value !== "::") {
    return undefined;
  }

  consumeNonIgnorable(state);
  const nameToken = consumeNonIgnorable(state);
  if (!isIdentifierToken(nameToken) || nameToken.value === "_") {
    throw new Error("Expected language name after '::'");
  }

  const repeatedMarker = peekNonIgnorable(state);
  if (repeatedMarker?.value === "::") {
    throw new Error("Repeated block annotation ':: Name'");
  }

  return nameToken.value;
}

function parseArgDeclGroup(state: DeclarationParserState, stopToken: string | undefined): ParsedArgDeclGroup {
  const positional: PositionalArgDecl[] = [];
  const keyedClauses: KeyedClauseDecl[] = [];
  let vararg: VarargDecl | undefined;
  let block: ClauseBlockDecl | undefined;

  let sawOptional = false;
  let sawKeyed = false;

  while (true) {
    const token = peekNonIgnorable(state);
    if (!token || (stopToken && token.value === stopToken) || (!stopToken && token.value === "{")) {
      break;
    }

    if (block) {
      throw new Error("Block marker '{}' must be the last item in a keyed clause declaration");
    }

    if (stopToken && token.value === "{") {
      consumeNonIgnorable(state);
      const closeToken = consumeNonIgnorable(state);
      if (!closeToken || closeToken.value !== "}") {
        throw new Error("Expected '}' to complete block marker '{}'");
      }
      const languageName = parseBlockAnnotation(state);
      block = languageName !== undefined ? { languageName } : {};
      continue;
    }

    if (token.value === "...") {
      if (vararg) {
        throw new Error("Only one vararg declaration '...' is allowed per clause");
      }

      consumeNonIgnorable(state);
      vararg = { trailingNamedArgs: [] };
      continue;
    }

    if (token.value === "(" || token.value === "[") {
      if (vararg) {
        throw new Error("Keyed clause declarations are not allowed after vararg '...'");
      }

      const opener = consumeNonIgnorable(state)!;
      const keywordToken = consumeNonIgnorable(state);
      if (!isIdentifierToken(keywordToken) || keywordToken.value === "_") {
        throw new Error(`Expected keyed clause keyword after ${describeToken(opener)}`);
      }

      const closer = opener.value === "(" ? ")" : "]";
      const argDecls = parseArgDeclGroup(state, closer);

      const closeToken = consumeNonIgnorable(state);
      if (!closeToken || closeToken.value !== closer) {
        throw new Error(`Expected '${closer}' to close keyed clause '${keywordToken.value}'`);
      }

      let allowMultiple = false;
      const quantifier = peekNonIgnorable(state);
      if (quantifier && (quantifier.value === "+" || quantifier.value === "*" || quantifier.value === "?")) {
        consumeNonIgnorable(state);

        if (opener.value === "(" && quantifier.value !== "+") {
          throw new Error(`Invalid quantifier '${quantifier.value}' for required keyed clause '(${keywordToken.value} ...)'`);
        }

        if (opener.value === "[" && quantifier.value !== "*") {
          throw new Error(`Invalid quantifier '${quantifier.value}' for optional keyed clause '[${keywordToken.value} ...]'`);
        }

        allowMultiple = true;
      }

      keyedClauses.push({
        keyword: keywordToken.value,
        required: opener.value === "(",
        allowMultiple,
        argDecls: {
          positional: argDecls.positional,
          keyedClauses: argDecls.keyedClauses,
          ...(argDecls.vararg ? { vararg: argDecls.vararg } : {})
        },
        ...(argDecls.block ? { block: argDecls.block } : {})
      });
      sawKeyed = true;
      continue;
    }

    if (!isIdentifierToken(token)) {
      throw new Error(`Unexpected token ${describeToken(token)} in argument declaration`);
    }

    const nameToken = consumeNonIgnorable(state)!;
    const optionalMarker = peekNonIgnorable(state);
    const optional = optionalMarker?.value === "?";

    if (optional) {
      consumeNonIgnorable(state);
    }

    if (vararg) {
      if (nameToken.value === "_" || optional) {
        throw new Error("Arguments declared after vararg '...' must be required named arguments");
      }
      vararg.trailingNamedArgs.push(nameToken.value);
      continue;
    }

    if (optional) {
      if (sawKeyed) {
        throw new Error("Optional positional arguments must be declared before keyed clauses");
      }
      sawOptional = true;
    } else {
      if (sawOptional || sawKeyed) {
        throw new Error("Required positional arguments must be declared before optional and keyed declarations");
      }
    }

    positional.push({
      kind: nameToken.value === "_" ? "unnamed" : "named",
      name: nameToken.value === "_" ? undefined : nameToken.value,
      optional
    });
  }

  return {
    positional,
    keyedClauses,
    vararg,
    ...(block !== undefined ? { block } : {})
  };
}

function collectGlobalKeywords(group: ArgDeclGroup, keywords: Set<string>): void {
  for (const clause of group.keyedClauses) {
    if (keywords.has(clause.keyword)) {
      throw new Error(`Duplicate keyed clause keyword '${clause.keyword}'`);
    }
    keywords.add(clause.keyword);
    collectGlobalKeywords(clause.argDecls, keywords);
  }
}

function previousNonIgnorableIndex(tokens: Token[], fromExclusive: number): number {
  let index = fromExclusive - 1;
  while (index >= 0 && isIgnorable(tokens[index]!)) {
    index -= 1;
  }
  return index;
}

function findBlockOpenTokenIndex(tokens: Token[], closeIndex: number): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i -= 1) {
    const token = tokens[i]!;
    if (token.type !== "delimiter") {
      continue;
    }
    if (token.value === "}") {
      depth += 1;
    } else if (token.value === "{") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  throw new Error("Unterminated nested block");
}

function hasBlockCloseTokenBefore(tokens: Token[], beforeIndex: number, minIndex: number): boolean {
  for (let i = beforeIndex - 1; i >= minIndex; i -= 1) {
    if (tokens[i]?.value === "}") {
      return true;
    }
  }
  return false;
}

function parseTrailingStatementBlocks(tokens: Token[], fromIndex: number): {
  argDeclTokens: Token[];
  blocks: StatementBlockDecl[];
} {
  const blocks: StatementBlockDecl[] = [];
  let endExclusive = tokens.length;

  while (true) {
    let cursor = previousNonIgnorableIndex(tokens, endExclusive);
    if (cursor < fromIndex) {
      break;
    }

    let languageName: string | undefined;
    const annotationNameIndex = cursor;
    if (isIdentifierToken(tokens[annotationNameIndex]) && previousNonIgnorableIndex(tokens, annotationNameIndex) >= fromIndex) {
      const annotationMarkerIndex = previousNonIgnorableIndex(tokens, annotationNameIndex);
      if (tokens[annotationMarkerIndex]?.value === "::") {
        languageName = tokens[annotationNameIndex]!.value;
        if (previousNonIgnorableIndex(tokens, annotationMarkerIndex) >= fromIndex && tokens[previousNonIgnorableIndex(tokens, annotationMarkerIndex)]?.value === "::") {
          throw new Error("Repeated block annotation ':: Name'");
        }
        endExclusive = annotationMarkerIndex;
        cursor = previousNonIgnorableIndex(tokens, endExclusive);
      }
    } else if (tokens[cursor]?.value === "::") {
      throw new Error("Expected language name after '::'");
    }

    if (languageName !== undefined && cursor >= fromIndex && tokens[cursor]?.value !== "}") {
      if (isIdentifierToken(tokens[cursor]) && tokens[previousNonIgnorableIndex(tokens, cursor)]?.value === "::") {
        throw new Error("Repeated block annotation ':: Name'");
      }
      throw new Error("Unexpected content after statement block");
    }

    if (cursor < fromIndex || tokens[cursor]?.value !== "}") {
      break;
    }

    const closeIndex = cursor;
    const openIndex = findBlockOpenTokenIndex(tokens, closeIndex);

    let blockName = "body";
    let blockStartIndex = openIndex;
    const possibleNameIndex = previousNonIgnorableIndex(tokens, openIndex);
    if (
      possibleNameIndex >= fromIndex &&
      isIdentifierToken(tokens[possibleNameIndex]) &&
      (blocks.length > 0 || hasBlockCloseTokenBefore(tokens, possibleNameIndex, fromIndex))
    ) {
      blockName = tokens[possibleNameIndex]!.value;
      blockStartIndex = possibleNameIndex;
    }

    blocks.unshift({
      name: blockName,
      required: true,
      allowMultiple: false,
      ...(languageName !== undefined ? { languageName } : {})
    });

    endExclusive = blockStartIndex;
  }

  return {
    argDeclTokens: tokens.slice(fromIndex, endExclusive),
    blocks
  };
}

export function parseStatementDeclaration(tokens: Token[]): StatementDeclaration {
  const state: DeclarationParserState = { tokens, index: 0 };
  const argumentOperatorSetName = parseEvaluateAnnotation(state);

  const qualifiers: QualifierDecl[] = [];
  while (true) {
    const keyword = peekNonIgnorable(state, 0);
    const marker = peekNonIgnorable(state, 1);

    if (!isIdentifierToken(keyword) || marker?.value !== "?") {
      break;
    }

    consumeNonIgnorable(state);
    consumeNonIgnorable(state);
    qualifiers.push({ keyword: keyword.value });
  }

  const commandNameToken = consumeNonIgnorable(state);
  if (!isIdentifierToken(commandNameToken) || commandNameToken.value === "_") {
    throw new Error("Expected command name after qualifiers");
  }

  const split = parseTrailingStatementBlocks(tokens, state.index);
  const argDeclState: DeclarationParserState = { tokens: split.argDeclTokens, index: 0 };
  const parsedArgDecls = parseArgDeclGroup(argDeclState, undefined);
  skipIgnorable(argDeclState);
  if (argDeclState.index < argDeclState.tokens.length) {
    throw new Error("Unexpected content after statement block");
  }

  const argDecls: ArgDeclGroup = {
    positional: parsedArgDecls.positional,
    keyedClauses: parsedArgDecls.keyedClauses,
    ...(parsedArgDecls.vararg ? { vararg: parsedArgDecls.vararg } : {})
  };

  const globalKeywords = new Set<string>();
  collectGlobalKeywords(argDecls, globalKeywords);

  return {
    name: commandNameToken.value,
    argumentOperatorSetName,
    qualifiers,
    argDecls,
    blocks: split.blocks,
    globalKeywords
  };
}

export function validateDeclaration(decl: StatementDeclaration, existingCommandNames: Set<string>): void {
  // Qualifier collisions with existing command names or clause keywords
  for (const q of decl.qualifiers) {
    if (existingCommandNames.has(q.keyword)) {
      throw new Error(`Qualifier keyword '${q.keyword}' collides with existing command name`);
    }
    if (decl.globalKeywords.has(q.keyword)) {
      throw new Error(`Qualifier keyword '${q.keyword}' collides with a keyed clause keyword`);
    }
  }

  const blockNames = new Set<string>();
  for (const block of decl.blocks) {
    if (blockNames.has(block.name)) {
      throw new Error(`Duplicate statement block '${block.name}'`);
    }
    blockNames.add(block.name);
  }

  function checkInvocationBlockCollisions(group: ArgDeclGroup): void {
    for (const clause of group.keyedClauses) {
      if (clause.block && blockNames.has(clause.keyword)) {
        throw new Error(`Invocation block clause '${clause.keyword}' collides with statement block '${clause.keyword}'`);
      }
      checkInvocationBlockCollisions(clause.argDecls);
    }
  }

  checkInvocationBlockCollisions(decl.argDecls);

  // If a group has vararg with trailing named args, no descendant may contain a vararg
  function descHasVararg(group: ArgDeclGroup): boolean {
    if (group.vararg) return true;
    for (const clause of group.keyedClauses) {
      if (descHasVararg(clause.argDecls)) return true;
    }
    return false;
  }

  function checkNestedVararg(group: ArgDeclGroup): void {
    if (group.vararg && group.vararg.trailingNamedArgs.length > 0) {
      for (const clause of group.keyedClauses) {
        if (descHasVararg(clause.argDecls)) {
          throw new Error("Nested keyword clauses cannot contain '...' when a higher-level clause contains trailing required positional declarations");
        }
      }
    }

    for (const clause of group.keyedClauses) {
      checkNestedVararg(clause.argDecls);
    }
  }

  checkNestedVararg(decl.argDecls);
}
