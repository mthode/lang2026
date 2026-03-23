import { parseCommandDeclaration, parseInvocation, validateDeclaration, validateInvocation } from "../../parser/index.js";
import { renderTemplateVariables } from "../../lang/expression.js";
import { scan } from "../../scanner/index.js";
import { executeBodyStatements } from "../utils/body.js";
import type {
  ShellCommandContext,
  ShellCommandExecutor,
  ShellEnvironment,
  UserCommandDefinition
} from "./types.js";

export const executeCmdCommand: ShellCommandExecutor = (command, _context, environment) => {
  const declarationSource = readRawVararg(command.args.declaration).join(" ").trim();
  if (declarationSource.length === 0) {
    throw new Error("'cmd' requires: cmd COMMAND_NAME ARG_DECLS { COMMANDS }");
  }

  const declaration = parseCommandDeclaration(scan(declarationSource));
  if (environment.expressionFunctions.has(declaration.name)) {
    throw new Error(`Cannot define command '${declaration.name}': a function with that name already exists`);
  }

  validateDeclaration(declaration, new Set(environment.commands.keys()));
  environment.commands.set(declaration.name, { declaration });
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

  const invocation = parseInvocation(scan(statementRaw), definition.declaration);
  validateInvocation(invocation, definition.declaration);

  const renderedArgs = toTemplateVariables(invocation, definition);
  const resolvedBody = renderTemplateVariables(definition.declaration.body.content, renderedArgs);

  const outputs = executeBodyStatements(resolvedBody, context, environment);

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
