import type { Token } from "../scanner/index.js";
import { extractNestedBlock, type ArgumentValue, type NestedBlockNode } from "./command.js";
import { isIgnorable } from "./expression.js";

export interface PositionalArgDecl {
  kind: "named" | "unnamed";
  name?: string;
  optional: boolean;
}

export interface VarargDecl {
  trailingNamedArgs: string[];
}

export interface KeyedClauseDecl {
  keyword: string;
  required: boolean;
  allowMultiple: boolean;
  argDecls: ArgDeclGroup;
}

export interface QualifierDecl {
  keyword: string;
}

export interface ArgDeclGroup {
  positional: PositionalArgDecl[];
  keyedClauses: KeyedClauseDecl[];
  vararg?: VarargDecl;
}

export interface CommandDeclaration {
  name: string;
  argumentOperatorSetName?: string;
  qualifiers: QualifierDecl[];
  argDecls: ArgDeclGroup;
  body: NestedBlockNode;
  bodyStatementSetName?: string;
  globalKeywords: Set<string>;
}

export interface ParsedArguments {
  clauseName: string;
  namedArgs: Record<string, ArgumentValue>;
  varArgs: ArgumentValue[];
  clauses: Record<string, ParsedArguments[]>;
}

export interface ParsedCommand {
  commandName: string;
  qualifiers: Record<string, boolean>;
  arguments: ParsedArguments;
}

interface DeclarationParserState {
  tokens: Token[];
  index: number;
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

function parseBodyStatementAnnotation(tokens: Token[]): string | undefined {
  const trailingTokens = tokens.filter((token) => !isIgnorable(token));
  if (trailingTokens.length === 0) {
    return undefined;
  }

  const marker = trailingTokens[0];
  if (marker?.value !== "::") {
    throw new Error("Unexpected content after command body");
  }

  const nameToken = trailingTokens[1];
  if (!isIdentifierToken(nameToken) || nameToken.value === "_") {
    throw new Error("Expected statement set name after '::'");
  }

  if (trailingTokens.length === 2) {
    return nameToken.value;
  }

  if (trailingTokens[2]?.value === "::") {
    throw new Error("Repeated body annotation ':: Name'");
  }

  throw new Error("Unexpected content after command body");
}

function parseArgDeclGroup(state: DeclarationParserState, stopToken: string | undefined): ArgDeclGroup {
  const positional: PositionalArgDecl[] = [];
  const keyedClauses: KeyedClauseDecl[] = [];
  let vararg: VarargDecl | undefined;

  let sawOptional = false;
  let sawKeyed = false;

  while (true) {
    const token = peekNonIgnorable(state);
    if (!token || (stopToken && token.value === stopToken) || token.value === "{") {
      break;
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
        argDecls
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
    vararg
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

function sourceIndexAtToken(tokens: Token[], tokenIndex: number): number {
  let offset = 0;
  for (let i = 0; i < tokenIndex; i += 1) {
    offset += tokens[i]?.value.length ?? 0;
  }
  return offset;
}

function findBlockCloseTokenIndex(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.type !== "delimiter") {
      continue;
    }
    if (token.value === "{") {
      depth += 1;
    } else if (token.value === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  throw new Error("Unterminated nested block");
}

export function parseCommandDeclaration(tokens: Token[]): CommandDeclaration {
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

  const argDecls = parseArgDeclGroup(state, "{");

  skipIgnorable(state);
  const bodyToken = state.tokens[state.index];
  if (!bodyToken || bodyToken.value !== "{") {
    throw new Error("Expected command body '{ ... }'");
  }

  const rawSource = tokens.map((token) => token.value).join("");
  const bodyStartOffset = sourceIndexAtToken(tokens, state.index);
  const body = extractNestedBlock(rawSource, bodyStartOffset);

  const closeTokenIndex = findBlockCloseTokenIndex(tokens, state.index);
  const bodyStatementSetName = parseBodyStatementAnnotation(tokens.slice(closeTokenIndex + 1));

  const globalKeywords = new Set<string>();
  collectGlobalKeywords(argDecls, globalKeywords);

  return {
    name: commandNameToken.value,
    argumentOperatorSetName,
    qualifiers,
    argDecls,
    body: {
      kind: "nested-block",
      content: body.content
    },
    bodyStatementSetName,
    globalKeywords
  };
}

export function validateDeclaration(decl: CommandDeclaration, existingCommandNames: Set<string>): void {
  // Qualifier collisions with existing command names or clause keywords
  for (const q of decl.qualifiers) {
    if (existingCommandNames.has(q.keyword)) {
      throw new Error(`Qualifier keyword '${q.keyword}' collides with existing command name`);
    }
    if (decl.globalKeywords.has(q.keyword)) {
      throw new Error(`Qualifier keyword '${q.keyword}' collides with a keyed clause keyword`);
    }
  }

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
