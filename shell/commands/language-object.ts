import {
  cloneCommandSet,
  cloneLanguage,
  cloneOperatorSet,
  compactTokens,
  createLanguage,
  extractNestedBlock,
  resolveNamedCommandSet,
  resolveNamedOperatorSet,
  type CommandSetDefinition,
  type InfixOperatorDefinition,
  type OperatorSetDefinition,
  type PrefixOperatorDefinition
} from "../../parser/index.js";
import { scan, type Token } from "../../scanner/index.js";
import {
  registerCommandSet,
  registerOperatorSet,
  registerStatementSet,
  shellCommandDefinitions
} from "../custom-language.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeOpsetCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readDeclarationSource(command.args.declaration, "'opset' requires: opset NAME { DEFINITIONS }");
  const { name, definition } = parseOperatorSetDeclaration(declarationSource);

  registerOperatorSet(environment.operatorSets, name, cloneOperatorSet(definition));
  return undefined;
};

export const executeCmdsetCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readDeclarationSource(command.args.declaration, "'cmdset' requires: cmdset NAME { COMMANDS }");
  const { name, definition } = parseCommandSetDeclaration(declarationSource);

  registerCommandSet(environment.commandSets, name, cloneCommandSet(definition));
  return undefined;
};

export const executeStmtsetCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readDeclarationSource(
    command.args.declaration,
    "'stmtset' requires: stmtset NAME commands COMMAND_SET operators OPERATOR_SET"
  );
  const { name, commandSetName, operatorSetName } = parseStatementSetDeclaration(declarationSource);

  const commandSet = resolveNamedCommandSet(environment.commandSets, commandSetName);
  const operatorSet = resolveNamedOperatorSet(environment.operatorSets, operatorSetName);

  const definition = createLanguage({
    commandSet,
    operatorSet
  });

  registerStatementSet(environment.statementSets, name, cloneLanguage(definition));
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

function parseCommandSetDeclaration(source: string): { name: string; definition: CommandSetDefinition } {
  const { name, body } = parseNamedBlockDeclaration(source, "command set");
  const tokens = compactTokens(scan(body));
  const commands: CommandSetDefinition["commands"] = {};
  const unsupportedConstructs = new Set(["import", "extend", "compose", "include", "use"]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || isSeparator(token)) {
      continue;
    }

    if (token.type !== "identifier") {
      throw new Error(`Expected command name in command set body, got '${token.value}'`);
    }

    if (unsupportedConstructs.has(token.value)) {
      throw new Error(`Unsupported command set construct '${token.value}'`);
    }

    const definition = shellCommandDefinitions[token.value];
    if (!definition) {
      throw new Error(`Unknown command '${token.value}'`);
    }

    if (commands[token.value]) {
      throw new Error(`Duplicate command '${token.value}' in command set body`);
    }

    commands[token.value] = definition;
  }

  return {
    name,
    definition: {
      name,
      commands,
      strictCommands: true
    }
  };
}

function parseStatementSetDeclaration(source: string): {
  name: string;
  commandSetName: string;
  operatorSetName: string;
} {
  const tokens = compactTokens(scan(source));
  const [
    nameToken,
    commandsKeyword,
    commandSetToken,
    operatorsKeyword,
    operatorSetToken,
    extraToken
  ] = tokens;

  if (!nameToken || nameToken.type !== "identifier") {
    throw new Error("Statement set declaration must start with a name");
  }

  if (!commandsKeyword || commandsKeyword.type !== "identifier" || commandsKeyword.value !== "commands") {
    throw new Error("Statement set declaration must include 'commands COMMAND_SET'");
  }

  if (!commandSetToken || commandSetToken.type !== "identifier") {
    throw new Error("Statement set declaration must name a command set");
  }

  if (!operatorsKeyword || operatorsKeyword.type !== "identifier" || operatorsKeyword.value !== "operators") {
    throw new Error("Statement set declaration must include 'operators OPERATOR_SET'");
  }

  if (!operatorSetToken || operatorSetToken.type !== "identifier") {
    throw new Error("Statement set declaration must name an operator set");
  }

  if (extraToken) {
    throw new Error(`Unexpected token '${extraToken.value}' after statement set declaration`);
  }

  return {
    name: nameToken.value,
    commandSetName: commandSetToken.value,
    operatorSetName: operatorSetToken.value
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
  const value = source.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${message} '${value}'`);
  }

  return value;
}

function readDeclarationSource(value: unknown, usage: string): string {
  const source = readRawVararg(value).join(" ").trim();
  if (source.length === 0) {
    throw new Error(usage);
  }

  return source;
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

function isSeparator(token: Token): boolean {
  return token.type === "delimiter" && (token.value === ";" || token.value === ",");
}

function skipSeparators(tokens: Token[], from: number): number {
  let index = from;
  while (index < tokens.length && tokens[index] && isSeparator(tokens[index]!)) {
    index += 1;
  }

  return index;
}