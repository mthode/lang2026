import {
  resolveNamedOperatorSet,
  resolveNamedLanguage,
  toExpressionParserConfig,
  extractNestedBlock
} from "../../parser/index.js";
import { parseStatementDeclaration, validateDeclaration } from "../declaration.js";
import { parseInvocation, validateInvocation } from "../invocation.js";
import { renderTemplateVariables, stringifyExpression } from "../../lang/expression.js";
import { isIgnorable } from "../../parser/expression.js";
import { scan, type Token } from "../../scanner/index.js";
import { executeBodyStatements } from "../utils/body.js";
import {
  UserCommandDefinition,
  type ShellCommandContext,
  type ShellCommandExecutor,
  type ShellEnvironment
} from "./types.js";

export const executeCmdCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readRawVararg(command.args.declaration).join(" ").trim();
  if (declarationSource.length === 0) {
    throw new Error("'cmd' requires: cmd COMMAND_NAME ARG_DECLS { COMMANDS }");
  }

  const declarationTokens = scan(declarationSource);
  const declaration = parseStatementDeclaration(declarationTokens);
  if (environment.expressionFunctions.has(declaration.name)) {
    throw new Error(`Cannot define command '${declaration.name}': a function with that name already exists`);
  }
  const implementationBlock = getSingleImplementationBlock(extractCommandImplementationBlocks(declarationTokens), declaration.name);

  const argumentOperatorSet = declaration.argumentOperatorSetName
    ? resolveNamedOperatorSet(environment.operatorSets, declaration.argumentOperatorSetName)
    : undefined;
  const bodyLanguage = implementationBlock.languageName
    ? resolveNamedLanguage(environment.languages, implementationBlock.languageName)
    : undefined;

  validateDeclaration(declaration, new Set(environment.commands.keys()));
  environment.commands.set(
    declaration.name,
    new UserCommandDefinition(
      declaration,
      implementationBlock.content,
      implementationBlock.languageName,
      argumentOperatorSet,
      bodyLanguage
    )
  );
  return undefined;
};

export function executeUserCommand(
  commandName: string,
  statementRaw: string,
  context: ShellCommandContext,
  environment: ShellEnvironment
): string | undefined {
  const definition = environment.commands.get(commandName);
  if (!definition) {
    return undefined;
  }

  const invocation = parseInvocation(
    scan(statementRaw),
    definition.declaration,
    definition.argumentOperatorSet
      ? { expressionConfig: toExpressionParserConfig(definition.argumentOperatorSet) }
      : undefined
  );
  validateInvocation(invocation, definition.declaration);

  const renderedArgs = toTemplateVariables(invocation, definition);
  const resolvedBody = renderTemplateVariables(definition.implementationBody, renderedArgs);

  const outputs = executeBodyStatements(resolvedBody, context, environment, definition.bodyLanguage);

  return outputs.length > 0 ? outputs.join("\n") : undefined;
}

function toTemplateVariables(
  invocation: ReturnType<typeof parseInvocation>,
  definition: UserCommandDefinition
): Record<string, string | number | boolean | Array<string | number | boolean> | undefined> {
  const output: Record<string, string | number | boolean | Array<string | number | boolean> | undefined> = {
    ...invocation.qualifiers
  };

  const normalizeValue = (value: unknown): string | number | boolean | undefined => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (value && typeof value === "object" && "kind" in value && (value as { kind?: string }).kind === "nested-block") {
      const blockValue = value as { content?: unknown };
      return typeof blockValue.content === "string" ? blockValue.content : undefined;
    }

    if (value && typeof value === "object" && "kind" in value) {
      return stringifyExpression(value as Parameters<typeof stringifyExpression>[0]);
    }

    return undefined;
  };

  for (const [key, value] of Object.entries(invocation.arguments.namedArgs)) {
    output[key] = normalizeValue(value);
  }

  // Provide 1-based positional aliases so command bodies can reference $1, $2, ...
  const positionalValues: Array<string | number | boolean | undefined> = [];
  let unnamedIndex = 0;

  for (const declaration of definition.declaration.argDecls.positional) {
    if (declaration.kind === "named" && declaration.name) {
      positionalValues.push(normalizeValue(invocation.arguments.namedArgs[declaration.name]));
      continue;
    }

    positionalValues.push(normalizeValue(invocation.arguments.varArgs[unnamedIndex]));
    unnamedIndex += 1;
  }

  for (let i = unnamedIndex; i < invocation.arguments.varArgs.length; i += 1) {
    positionalValues.push(normalizeValue(invocation.arguments.varArgs[i]));
  }

  for (let i = 0; i < positionalValues.length; i += 1) {
    output[String(i + 1)] = positionalValues[i];
  }

  if (invocation.arguments.varArgs.length > 0) {
    output.args = invocation.arguments.varArgs.map((value) => normalizeValue(value)).filter((v): v is string | number | boolean => v !== undefined);
  }

  for (const [keyword, occurrences] of Object.entries(invocation.arguments.clauses)) {
    if (occurrences.length === 0) {
      continue;
    }

    const scalars = occurrences.map((occurrence) => {
      if (occurrence.varArgs.length === 1 && Object.keys(occurrence.namedArgs).length === 0) {
        return normalizeValue(occurrence.varArgs[0]);
      }
      return undefined;
    });

    if (occurrences.length === 1 && scalars[0] !== undefined) {
      output[keyword] = scalars[0];
      continue;
    }

    const packed = scalars.filter((value): value is string | number | boolean => value !== undefined);
    if (packed.length > 0) {
      output[keyword] = packed;
    }
  }

  // Keep command body rendering rooted in the declaration that produced this invocation.
  output.command = definition.declaration.name;

  return output;
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

interface CommandImplementationBlock {
  name: string;
  content: string;
  required: boolean;
  allowMultiple: boolean;
  languageName?: string;
}

interface CommandDeclarationParserState {
  tokens: Token[];
  index: number;
}

function skipIgnorable(state: CommandDeclarationParserState): void {
  while (state.index < state.tokens.length && isIgnorable(state.tokens[state.index]!)) {
    state.index += 1;
  }
}

function peekNonIgnorable(state: CommandDeclarationParserState, lookahead = 0): Token | undefined {
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

function consumeNonIgnorable(state: CommandDeclarationParserState): Token | undefined {
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

function parseEvaluateAnnotation(state: CommandDeclarationParserState): void {
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

  const repeatedMarker = peekNonIgnorable(state);
  const repeatedKeyword = peekNonIgnorable(state, 1);
  if (repeatedMarker?.value === "--" && isIdentifierToken(repeatedKeyword) && repeatedKeyword.value === "evaluate") {
    throw new Error("Repeated '--evaluate' annotation");
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

function extractCommandImplementationBlocks(tokens: Token[]): CommandImplementationBlock[] {
  const state: CommandDeclarationParserState = { tokens, index: 0 };
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
    throw new Error("Expected command name after qualifiers");
  }

  const blocks: CommandImplementationBlock[] = [];
  const rawSource = tokens.map((token) => token.value).join("");
  let endExclusive = tokens.length;

  while (true) {
    let cursor = previousNonIgnorableIndex(tokens, endExclusive);
    if (cursor < state.index) {
      break;
    }

    let languageName: string | undefined;
    const annotationNameIndex = cursor;
    if (isIdentifierToken(tokens[annotationNameIndex]) && previousNonIgnorableIndex(tokens, annotationNameIndex) >= state.index) {
      const annotationMarkerIndex = previousNonIgnorableIndex(tokens, annotationNameIndex);
      if (tokens[annotationMarkerIndex]?.value === "::") {
        languageName = tokens[annotationNameIndex]!.value;
        if (previousNonIgnorableIndex(tokens, annotationMarkerIndex) >= state.index && tokens[previousNonIgnorableIndex(tokens, annotationMarkerIndex)]?.value === "::") {
          throw new Error("Repeated block annotation ':: Name'");
        }
        endExclusive = annotationMarkerIndex;
        cursor = previousNonIgnorableIndex(tokens, endExclusive);
      }
    } else if (tokens[cursor]?.value === "::") {
      throw new Error("Expected language name after '::'");
    }

    if (languageName !== undefined && cursor >= state.index && tokens[cursor]?.value !== "}") {
      if (isIdentifierToken(tokens[cursor]) && tokens[previousNonIgnorableIndex(tokens, cursor)]?.value === "::") {
        throw new Error("Repeated block annotation ':: Name'");
      }
      throw new Error("Unexpected content after statement block");
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
      content: block.content,
      required: true,
      allowMultiple: false,
      ...(languageName !== undefined ? { languageName } : {})
    });

    endExclusive = blockStartIndex;
  }

  return blocks;
}

function getSingleImplementationBlock(blocks: CommandImplementationBlock[], commandName?: string) {
  if (blocks.length !== 1) {
    throw new Error(`Command '${commandName ?? "<unknown>"}' must declare exactly one implementation block`);
  }

  const block = blocks[0]!;
  if (block.name !== "body" || !block.required || block.allowMultiple) {
    throw new Error(`Command '${commandName ?? "<unknown>"}' must use a single required 'body' implementation block`);
  }

  return block;
}
