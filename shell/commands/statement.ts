import {
  extractNestedBlock,
  parseStatementDeclaration,
  validateDeclaration
} from "../../parser/index.js";
import { isIgnorable } from "../../parser/expression.js";
import { scan, type Token } from "../../scanner/index.js";
import { shellStatementDefinitions } from "../custom-language.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeStmtCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readRawVararg(command.args.declaration).join(" ").trim();
  if (declarationSource.length === 0) {
    throw new Error("'stmt' requires: stmt STATEMENT_NAME DECLARATION");
  }

  const declarationTokens = scan(declarationSource);
  const declaration = parseStatementDeclaration(declarationTokens);

  if (environment.expressionFunctions.has(declaration.name)) {
    throw new Error(`Cannot define statement '${declaration.name}': a function with that name already exists`);
  }

  if (shellStatementDefinitions[declaration.name]) {
    throw new Error(`Cannot define statement '${declaration.name}': a shell statement with that name already exists`);
  }

  if (environment.commands.has(declaration.name)) {
    throw new Error(`Cannot define statement '${declaration.name}': an executable command with that name already exists`);
  }

  if (environment.statementDeclarations.has(declaration.name)) {
    throw new Error(`Cannot redefine statement '${declaration.name}'`);
  }

  validateStatementDeclarationBlocks(declarationTokens, declaration.name);
  validateDeclaration(
    declaration,
    new Set([
      ...Object.keys(shellStatementDefinitions),
      ...environment.commands.keys(),
      ...environment.statementDeclarations.keys()
    ])
  );

  environment.statementDeclarations.set(declaration.name, declaration);
  return undefined;
};

interface StatementDeclarationBlock {
  name: string;
  content: string;
}

interface StatementDeclarationParserState {
  tokens: Token[];
  index: number;
}

function readRawVararg(value: unknown): string[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

function validateStatementDeclarationBlocks(tokens: Token[], statementName: string): void {
  const blocks = extractStatementDeclarationBlocks(tokens);
  for (const block of blocks) {
    if (block.content.trim().length > 0) {
      throw new Error(
        `Statement '${statementName}' block '${block.name}' must be declared with an empty shape-only body`
      );
    }
  }
}

function skipIgnorable(state: StatementDeclarationParserState): void {
  while (state.index < state.tokens.length && isIgnorable(state.tokens[state.index]!)) {
    state.index += 1;
  }
}

function peekNonIgnorable(state: StatementDeclarationParserState, lookahead = 0): Token | undefined {
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

function consumeNonIgnorable(state: StatementDeclarationParserState): Token | undefined {
  skipIgnorable(state);
  const token = state.tokens[state.index];
  if (!token) {
    return undefined;
  }
  state.index += 1;
  return token;
}

function isIdentifierToken(token: Token | undefined): token is Token {
  return token?.type === "identifier";
}

function parseEvaluateAnnotation(state: StatementDeclarationParserState): void {
  const marker = peekNonIgnorable(state);
  const keyword = peekNonIgnorable(state, 1);

  if (marker?.value !== "--" || !isIdentifierToken(keyword) || keyword.value !== "evaluate") {
    return;
  }

  consumeNonIgnorable(state);
  consumeNonIgnorable(state);
  const nameToken = consumeNonIgnorable(state);
  if (!isIdentifierToken(nameToken) || nameToken.value === "_") {
    throw new Error("Expected operator set name after '--evaluate'");
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

function sourceIndexAtToken(tokens: Token[], tokenIndex: number): number {
  let offset = 0;
  for (let i = 0; i < tokenIndex; i += 1) {
    offset += tokens[i]?.value.length ?? 0;
  }
  return offset;
}

function hasBlockCloseTokenBefore(tokens: Token[], beforeIndex: number, minIndex: number): boolean {
  for (let i = beforeIndex - 1; i >= minIndex; i -= 1) {
    if (tokens[i]?.value === "}") {
      return true;
    }
  }
  return false;
}

function extractStatementDeclarationBlocks(tokens: Token[]): StatementDeclarationBlock[] {
  const state: StatementDeclarationParserState = { tokens, index: 0 };
  parseEvaluateAnnotation(state);

  while (true) {
    const keyword = peekNonIgnorable(state, 0);
    const marker = peekNonIgnorable(state, 1);
    if (!isIdentifierToken(keyword) || marker?.value !== "?") {
      break;
    }
    consumeNonIgnorable(state);
    consumeNonIgnorable(state);
  }

  const nameToken = consumeNonIgnorable(state);
  if (!isIdentifierToken(nameToken) || nameToken.value === "_") {
    throw new Error("Expected statement name after qualifiers");
  }

  const blocks: StatementDeclarationBlock[] = [];
  const rawSource = tokens.map((token) => token.value).join("");
  let endExclusive = tokens.length;

  while (true) {
    let cursor = previousNonIgnorableIndex(tokens, endExclusive);
    if (cursor < state.index) {
      break;
    }

    const annotationNameIndex = cursor;
    if (isIdentifierToken(tokens[annotationNameIndex]) && previousNonIgnorableIndex(tokens, annotationNameIndex) >= state.index) {
      const annotationMarkerIndex = previousNonIgnorableIndex(tokens, annotationNameIndex);
      if (tokens[annotationMarkerIndex]?.value === "::") {
        endExclusive = annotationMarkerIndex;
        cursor = previousNonIgnorableIndex(tokens, endExclusive);
      }
    }

    if (cursor < state.index || tokens[cursor]?.value !== "}") {
      break;
    }

    const closeIndex = cursor;
    const openIndex = findBlockOpenTokenIndex(tokens, closeIndex);
    const block = extractNestedBlock(rawSource, sourceIndexAtToken(tokens, openIndex));

    let blockName = "body";
    let blockStartIndex = openIndex;
    const possibleNameIndex = previousNonIgnorableIndex(tokens, openIndex);
    if (
      possibleNameIndex >= state.index &&
      isIdentifierToken(tokens[possibleNameIndex]) &&
      (blocks.length > 0 || hasBlockCloseTokenBefore(tokens, possibleNameIndex, state.index))
    ) {
      blockName = tokens[possibleNameIndex]!.value;
      blockStartIndex = possibleNameIndex;
    }

    blocks.unshift({
      name: blockName,
      content: block.content
    });

    endExclusive = blockStartIndex;
  }

  return blocks;
}
