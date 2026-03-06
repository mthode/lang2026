import { extractNestedBlock, getCommandArgumentSource } from "../../parser/index.js";
import { renderTemplateVariables } from "../../lang/expression.js";
import { splitArgumentSegments } from "../utils/arguments.js";
import { executeBodyStatements } from "../utils/body.js";
import type {
  ShellCommandContext,
  ShellCommandExecutor,
  ShellEnvironment,
  UserCommandDefinition
} from "./types.js";

type CommandArgDeclaration = UserCommandDefinition["declarations"][number];

export const executeCmdCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readRawVararg(command.args.declaration).join(" ").trim();
  if (declarationSource.length === 0) {
    throw new Error("'cmd' requires: cmd COMMAND_NAME ARG_DECLS { COMMANDS }");
  }

  const definition = parseCommandDefinition(declarationSource);
  if (environment.expressionFunctions.has(definition.name)) {
    throw new Error(`Cannot define command '${definition.name}': a function with that name already exists`);
  }

  environment.commands.set(definition.name, definition);
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

  const remainder = getCommandArgumentSource(statementRaw);
  const segments = splitArgumentSegments(remainder);
  const invocation = parseCommandInvocationArguments(definition, segments, context, environment);
  const resolvedBody = renderTemplateVariables(definition.body, invocation);

  const outputs = executeBodyStatements(resolvedBody, context, environment);

  return outputs.length > 0 ? outputs.join("\n") : undefined;
}

function parseCommandDefinition(source: string): UserCommandDefinition {
  const block = extractNestedBlock(source, 0);
  const header = source.slice(0, block.openIndex).trim();
  const trailing = source.slice(block.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error("Unexpected content after command body");
  }

  const tokens = header.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new Error("Missing command name");
  }

  const [name, ...argTokens] = tokens;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid command name '${name}'`);
  }

  const declarations = argTokens.map(parseCommandArgToken);
  return {
    name,
    declarations,
    body: block.content
  };
}

function parseCommandArgToken(token: string): CommandArgDeclaration {
  const optional = token.startsWith("[") && token.endsWith("]");
  const inner = optional ? token.slice(1, -1) : token;

  if (inner.includes(":")) {
    const [name, rawCount] = inner.split(":");
    if (!name || !rawCount) {
      throw new Error(`Invalid argument declaration '${token}'`);
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid named argument declaration '${token}'`);
    }

    const valueCount = Number(rawCount);
    if (!Number.isInteger(valueCount) || valueCount < 0) {
      throw new Error(`Invalid NUM_ARGS in declaration '${token}'`);
    }

    return {
      name,
      optional,
      mode: "named",
      valueCount
    };
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
    throw new Error(`Invalid positional argument declaration '${token}'`);
  }

  return {
    name: inner,
    optional,
    mode: "positional"
  };
}

function parseCommandInvocationArguments(
  definition: UserCommandDefinition,
  segments: string[],
  context: ShellCommandContext,
  environment: ShellEnvironment
): Record<string, string | string[] | boolean | undefined> {
  const args: Record<string, string | string[] | boolean | undefined> = {};
  let cursor = 0;

  for (const declaration of definition.declarations) {
    if (declaration.mode === "positional") {
      if (cursor >= segments.length) {
        if (declaration.optional) {
          args[declaration.name] = undefined;
          continue;
        }
        throw new Error(`Missing required positional argument '${declaration.name}'`);
      }

      const value = segments[cursor] ?? "";
      validateExpression(value, declaration.name, context, environment);
      args[declaration.name] = value;
      cursor += 1;
      continue;
    }

    const token = segments[cursor] ?? "";
    if (token !== declaration.name) {
      if (declaration.optional) {
        args[declaration.name] = declaration.valueCount === 0 ? false : undefined;
        continue;
      }
      throw new Error(`Missing required named argument '${declaration.name}'`);
    }

    cursor += 1;

    if (declaration.valueCount === 0) {
      args[declaration.name] = true;
      continue;
    }

    if (cursor + declaration.valueCount > segments.length) {
      throw new Error(`Named argument '${declaration.name}' expects ${declaration.valueCount} values`);
    }

    const values = segments.slice(cursor, cursor + declaration.valueCount);
    values.forEach((value, index) => validateExpression(value, `${declaration.name}[${index}]`, context, environment));
    cursor += declaration.valueCount;

    args[declaration.name] = declaration.valueCount === 1 ? values[0] : values;
  }

  if (cursor < segments.length) {
    throw new Error("Unexpected extra arguments when calling command");
  }

  return args;
}

function validateExpression(source: string, argName: string, context: ShellCommandContext, environment: ShellEnvironment): void {
  try {
    const statement = context.parseLine(`eval ${source}`, environment);
    context.executeStatement(statement, environment);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid expression for argument '${argName}': ${message}`);
  }
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
