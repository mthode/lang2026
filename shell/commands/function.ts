import { extractNestedBlock } from "../../parser/index.js";
import type { LangFunctionDefinition } from "../../lang/types.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeFuncCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declaration = readRawVararg(command.args.declaration).join(" ").trim();
  if (declaration.length === 0) {
    throw new Error("'func' requires: func FUNCTION_NAME ( PARAMS ) { FUNCTION_BODY }");
  }

  const definition = parseFunctionDefinition(declaration);

  if (environment.commands.has(definition.name)) {
    throw new Error(`Cannot define function '${definition.name}': a command with that name already exists`);
  }

  environment.expressionFunctions.set(definition.name, definition);
  return undefined;
};

function parseFunctionDefinition(source: string): LangFunctionDefinition {
  const block = extractNestedBlock(source, 0);
  const header = source.slice(0, block.openIndex).trim();
  const trailing = source.slice(block.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error("Unexpected content after function body");
  }

  const openParen = header.indexOf("(");
  const closeParen = header.lastIndexOf(")");
  if (openParen < 0 || closeParen < openParen) {
    throw new Error("Function declaration must include '( PARAMS )'");
  }

  const name = header.slice(0, openParen).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid function name '${name}'`);
  }

  const paramsSource = header.slice(openParen + 1, closeParen).trim();
  const parameters = parseParameters(paramsSource);

  return {
    name,
    parameters,
    body: block.content
  };
}

function parseParameters(source: string): string[] {
  if (source.length === 0) {
    return [];
  }

  const tokens = source.includes(",")
    ? source.split(",").map((token) => token.trim()).filter((token) => token.length > 0)
    : source.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0);

  for (const token of tokens) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
      throw new Error(`Invalid function parameter '${token}'`);
    }
  }

  const unique = new Set(tokens);
  if (unique.size !== tokens.length) {
    throw new Error("Function parameters must be unique");
  }

  return tokens;
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
