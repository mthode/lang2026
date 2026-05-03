import {
  cloneLanguage,
  cloneOperatorSet,
  compactTokens,
  createLanguage,
  extractNestedBlock,
  resolveNamedOperatorSet,
  type InfixOperatorDefinition,
  type OperatorSetDefinition,
  type PrefixOperatorDefinition,
  type StatementDefinition
} from "../../parser/index.js";
import { scan, type Token } from "../../scanner/index.js";
import {
  registerLanguage,
  registerOperatorSet,
  shellStatementDefinitions
} from "../custom-language.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeOperatorsCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readDeclarationSource(command.args.declaration, "'operators' requires: operators NAME { DEFINITIONS }");
  const { name, definition } = parseOperatorSetDeclaration(declarationSource);

  registerOperatorSet(environment.operatorSets, name, cloneOperatorSet(definition));
  return undefined;
};

export const executeLanguageCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readDeclarationSource(
    command.args.declaration,
    "'language' requires: language NAME operators OPERATOR_SET { STATEMENTS }"
  );
  const { name, operatorSetName, statementBody } = parseLanguageDeclaration(declarationSource);

  const operatorSet = resolveNamedOperatorSet(environment.operatorSets, operatorSetName);
  const statements = parseStatementDefinitions(statementBody, environment.statementDeclarations);

  const definition = createLanguage({
    name,
    statements,
    operatorSet,
    strictStatements: true
  });

  registerLanguage(environment.languages, name, cloneLanguage(definition));
  return undefined;
};

function parseOperatorSetDeclaration(source: string): { name: string; definition: OperatorSetDefinition } {
  const { name, body } = parseNamedBlockDeclaration(source, "operator set");
  const tokens = compactTokens(scan(body));
  const prefixOperators: Record<string, PrefixOperatorDefinition> = {};
  const infixOperators: Record<string, InfixOperatorDefinition> = {};

  let index = 0;
  while (index < tokens.length) {
    index = skipSeparators(tokens, index);
    if (index >= tokens.length) {
      break;
    }

    const kindToken = tokens[index++];
    if (kindToken?.type === "identifier" && kindToken.value !== "prefix" && kindToken.value !== "infix") {
      throw new Error(`Unsupported operator definition kind '${kindToken.value}'`);
    }

    if (!kindToken || kindToken.type !== "identifier" || (kindToken.value !== "prefix" && kindToken.value !== "infix")) {
      throw new Error("Operator definition must start with 'prefix' or 'infix'");
    }

    const operatorToken = tokens[index++];
    if (!operatorToken || isSeparator(operatorToken)) {
      throw new Error(`Missing operator token after '${kindToken.value}'`);
    }

    const precedenceKeyword = tokens[index++];
    if (!precedenceKeyword || precedenceKeyword.type !== "identifier" || precedenceKeyword.value !== "precedence") {
      throw new Error(`Expected 'precedence' after operator '${operatorToken.value}'`);
    }

    const precedenceToken = tokens[index++];
    if (!precedenceToken || precedenceToken.type !== "number") {
      throw new Error(`Expected numeric precedence for operator '${operatorToken.value}'`);
    }

    const precedence = Number(precedenceToken.value);
    if (!Number.isInteger(precedence)) {
      throw new Error(`Operator precedence must be an integer for '${operatorToken.value}'`);
    }

    if (kindToken.value === "prefix") {
      if (prefixOperators[operatorToken.value]) {
        throw new Error(`Duplicate prefix operator '${operatorToken.value}'`);
      }

      prefixOperators[operatorToken.value] = { precedence };
      continue;
    }

    const associativityToken = tokens[index];
    let associativity: "left" | "right" | undefined;
    if (associativityToken?.type === "identifier" && (associativityToken.value === "left" || associativityToken.value === "right")) {
      associativity = associativityToken.value;
      index += 1;
    } else if (
      associativityToken?.type === "identifier" &&
      associativityToken.value !== "prefix" &&
      associativityToken.value !== "infix"
    ) {
      throw new Error(`Unsupported infix associativity '${associativityToken.value}'`);
    }

    if (infixOperators[operatorToken.value]) {
      throw new Error(`Duplicate infix operator '${operatorToken.value}'`);
    }

    infixOperators[operatorToken.value] = associativity ? { precedence, associativity } : { precedence };
  }

  return {
    name,
    definition: {
      name,
      prefixOperators,
      infixOperators
    }
  };
}

function parseStatementDefinitions(
  source: string,
  statementDeclarations: ReadonlyMap<string, StatementDefinition>
): Record<string, StatementDefinition> {
  const tokens = compactTokens(scan(source));
  const statements: Record<string, StatementDefinition> = {};
  const unsupportedConstructs = new Set(["import", "extend", "compose", "include", "use"]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || isSeparator(token)) {
      continue;
    }

    if (token.type !== "identifier") {
      throw new Error(`Expected statement name in language statement body, got '${token.value}'`);
    }

    if (unsupportedConstructs.has(token.value)) {
      throw new Error(`Unsupported language statement construct '${token.value}'`);
    }

    const definition = shellStatementDefinitions[token.value] ?? statementDeclarations.get(token.value);
    if (!definition) {
      throw new Error(`Unknown statement '${token.value}'`);
    }

    if (statements[token.value]) {
      throw new Error(`Duplicate statement '${token.value}' in language statement body`);
    }

    statements[token.value] = definition;
  }

  return statements;
}

function parseLanguageDeclaration(source: string): {
  name: string;
  operatorSetName: string;
  statementBody: string;
} {
  const block = extractNestedBlock(source, 0);
  const header = source.slice(0, block.openIndex).trim();
  const trailing = source.slice(block.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error("Unexpected content after language statement body");
  }

  const tokens = compactTokens(scan(header));
  const [
    nameToken,
    operatorsKeyword,
    operatorSetToken,
    extraToken
  ] = tokens;

  if (!nameToken || nameToken.type !== "identifier") {
    throw new Error("Language declaration must start with a name");
  }

  if (!operatorsKeyword || operatorsKeyword.type !== "identifier" || operatorsKeyword.value !== "operators") {
    throw new Error("Language declaration must include 'operators OPERATOR_SET'");
  }

  if (!operatorSetToken || operatorSetToken.type !== "identifier") {
    throw new Error("Language declaration must name an operator set");
  }

  if (extraToken) {
    throw new Error(`Unexpected token '${extraToken.value}' after language declaration`);
  }

  return {
    name: nameToken.value,
    operatorSetName: operatorSetToken.value,
    statementBody: block.content
  };
}

function parseNamedBlockDeclaration(source: string, kind: string): { name: string; body: string } {
  const block = extractNestedBlock(source, 0);
  const header = source.slice(0, block.openIndex).trim();
  const trailing = source.slice(block.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error(`Unexpected content after ${kind} body`);
  }

  const name = parseIdentifier(header, `Invalid ${kind} name`);
  return { name, body: block.content };
}

function parseIdentifier(source: string, message: string): string {
  const tokens = compactTokens(scan(source));
  if (tokens.length !== 1 || tokens[0]?.type !== "identifier") {
    throw new Error(message);
  }
  return tokens[0].value;
}

function readDeclarationSource(value: unknown, emptyMessage: string): string {
  const parts = Array.isArray(value) ? value : [value];
  const source = parts.filter((part): part is string => typeof part === "string").join(" ").trim();
  if (source.length === 0) {
    throw new Error(emptyMessage);
  }
  return source;
}

function isSeparator(token: Token): boolean {
  return token.value === "," || token.value === ";";
}

function skipSeparators(tokens: Token[], index: number): number {
  let cursor = index;
  while (cursor < tokens.length && isSeparator(tokens[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}
