import type { CommandDefinition, ParserConfig } from "./command.js";
import type {
  ExpressionParserConfig,
  InfixOperatorDefinition,
  PrefixOperatorDefinition
} from "./expression.js";

export interface OperatorSetDefinition {
  name?: string;
  prefixOperators: Record<string, PrefixOperatorDefinition>;
  infixOperators: Record<string, InfixOperatorDefinition>;
}

export interface CommandSetDefinition {
  name?: string;
  commands: Record<string, CommandDefinition>;
  defaultCommand?: CommandDefinition;
  strictCommands?: boolean;
}

export interface Language {
  commandSet: CommandSetDefinition;
  operatorSet: OperatorSetDefinition;
  allowAssignmentStatements?: boolean;
}

export function createLanguage(
  parts: Pick<Language, "commandSet" | "operatorSet">,
  overrides: Partial<Pick<Language, "allowAssignmentStatements">> = {}
): Language {
  return {
    operatorSet: cloneOperatorSet(parts.operatorSet),
    commandSet: cloneCommandSet(parts.commandSet),
    ...(overrides.allowAssignmentStatements !== undefined
      ? { allowAssignmentStatements: overrides.allowAssignmentStatements }
      : {})
  };
}

export function toExpressionParserConfig(operatorSet: OperatorSetDefinition): ExpressionParserConfig {
  return {
    prefixOperators: { ...operatorSet.prefixOperators },
    infixOperators: { ...operatorSet.infixOperators }
  };
}

export function toCommandParserDefinition(
  commandSet: CommandSetDefinition
): Pick<ParserConfig, "commands" | "strictCommands" | "defaultCommand"> {
  return {
    commands: cloneCommandDefinitions(commandSet.commands),
    strictCommands: commandSet.strictCommands,
    defaultCommand: commandSet.defaultCommand ? cloneCommandDefinition(commandSet.defaultCommand) : undefined
  };
}

export function toParserConfig(language: Language): ParserConfig {
  return {
    ...toExpressionParserConfig(language.operatorSet),
    ...toCommandParserDefinition(language.commandSet),
    ...(language.allowAssignmentStatements !== undefined
      ? { allowAssignmentStatements: language.allowAssignmentStatements }
      : {})
  };
}

export function resolveNamedOperatorSet(
  registry: ReadonlyMap<string, OperatorSetDefinition>,
  name: string
): OperatorSetDefinition {
  const definition = registry.get(name);
  if (!definition) {
    throw new Error(`Unknown operator set '${name}'`);
  }

  return cloneOperatorSet(definition);
}

export function resolveNamedCommandSet(
  registry: ReadonlyMap<string, CommandSetDefinition>,
  name: string
): CommandSetDefinition {
  const definition = registry.get(name);
  if (!definition) {
    throw new Error(`Unknown command set '${name}'`);
  }

  return cloneCommandSet(definition);
}

export function resolveNamedStatementSet(
  registry: ReadonlyMap<string, Language>,
  name: string
): Language {
  const definition = registry.get(name);
  if (!definition) {
    throw new Error(`Unknown statement set '${name}'`);
  }

  return cloneLanguage(definition);
}

export function cloneLanguage(definition: Language): Language {
  return {
    operatorSet: cloneOperatorSet(definition.operatorSet),
    commandSet: cloneCommandSet(definition.commandSet),
    ...(definition.allowAssignmentStatements !== undefined
      ? { allowAssignmentStatements: definition.allowAssignmentStatements }
      : {})
  };
}

export function cloneOperatorSet(definition: OperatorSetDefinition): OperatorSetDefinition {
  return {
    ...(definition.name !== undefined ? { name: definition.name } : {}),
    prefixOperators: { ...definition.prefixOperators },
    infixOperators: { ...definition.infixOperators }
  };
}

export function cloneCommandSet(definition: CommandSetDefinition): CommandSetDefinition {
  return {
    ...(definition.name !== undefined ? { name: definition.name } : {}),
    commands: cloneCommandDefinitions(definition.commands),
    strictCommands: definition.strictCommands,
    defaultCommand: definition.defaultCommand ? cloneCommandDefinition(definition.defaultCommand) : undefined
  };
}

function cloneCommandDefinitions(
  definitions: Record<string, CommandDefinition>
): Record<string, CommandDefinition> {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [name, cloneCommandDefinition(definition)])
  );
}

function cloneCommandDefinition(definition: CommandDefinition): CommandDefinition {
  return {
    arguments: definition.arguments?.map((argument) => ({
      ...argument,
      expressionOperators: argument.expressionOperators
        ? {
            prefixOperators: argument.expressionOperators.prefixOperators
              ? { ...argument.expressionOperators.prefixOperators }
              : undefined,
            infixOperators: argument.expressionOperators.infixOperators
              ? { ...argument.expressionOperators.infixOperators }
              : undefined
          }
        : undefined,
      nestedScope: argument.nestedScope
        ? cloneLanguage(argument.nestedScope)
        : undefined
    })),
    allowExtraArguments: definition.allowExtraArguments,
    argumentKind: definition.argumentKind,
    parseNamedArguments: definition.parseNamedArguments,
    consumeRestAsSingleArgument: definition.consumeRestAsSingleArgument
  };
}