import {
  cloneCommandSet,
  cloneLanguage,
  cloneOperatorSet,
  createLanguage,
  type CommandDefinition,
  type CommandSetDefinition,
  type OperatorSetDefinition,
  type Language
} from "../parser/index.js";
import { expressionConfig } from "../lang/expression-config.js";

export const SHELL_OPERATOR_SET_NAME = "shell_ops";
export const SHELL_COMMAND_SET_NAME = "shell_cmds";
export const SHELL_STATEMENT_SET_NAME = "shell_stmt";

export const shellCommandDefinitions: Record<string, CommandDefinition> = {
  cd: {
    arguments: [{ name: "path", kind: "raw", positional: true, vararg: true }]
  },
  cmd: {
    arguments: [{ name: "declaration", kind: "raw", positional: true, vararg: true }]
  },
  func: {
    arguments: [{ name: "declaration", kind: "raw", positional: true, vararg: true }]
  },
  if: {
    arguments: [
      { name: "condition", kind: "expression", positional: true },
      { name: "then", kind: "nested-block" },
      { name: "else", kind: "nested-block", optional: true }
    ]
  },
  while: {
    arguments: [
      { name: "condition", kind: "expression", positional: true },
      { name: "do", kind: "nested-block" }
    ]
  },
  for: {
    arguments: [
      { name: "iterator", kind: "expression", positional: true },
      { name: "from", kind: "expression" },
      { name: "to", kind: "expression" },
      { name: "step", kind: "expression", optional: true },
      { name: "do", kind: "nested-block" }
    ]
  },
  eval: {
    arguments: [{ name: "expression", kind: "expression", positional: true }]
  },
  echo: {
    arguments: [{ name: "extras", kind: "expression", positional: true, vararg: true }]
  },
  raw: {
    arguments: [{ name: "text", kind: "raw", positional: true, vararg: true }]
  }
};

export const shellOperatorSet: OperatorSetDefinition = {
  name: SHELL_OPERATOR_SET_NAME,
  prefixOperators: { ...expressionConfig.prefixOperators },
  infixOperators: { ...expressionConfig.infixOperators }
};

export const shellCommandSet: CommandSetDefinition = {
  ...cloneCommandSet({
    name: SHELL_COMMAND_SET_NAME,
    commands: shellCommandDefinitions,
    defaultCommand: {
      argumentKind: "raw",
      parseNamedArguments: false
    }
  })
};

export const shellStatementSet: Language = createLanguage({
  commandSet: shellCommandSet,
  operatorSet: shellOperatorSet
}, {
  allowAssignmentStatements: true
});

export function createShellLanguageRegistries(): {
  operatorSets: Map<string, OperatorSetDefinition>;
  commandSets: Map<string, CommandSetDefinition>;
  statementSets: Map<string, Language>;
} {
  return {
    operatorSets: new Map([[SHELL_OPERATOR_SET_NAME, cloneOperatorSet(shellOperatorSet)]]),
    commandSets: new Map([[SHELL_COMMAND_SET_NAME, cloneCommandSet(shellCommandSet)]]),
    statementSets: new Map([[SHELL_STATEMENT_SET_NAME, cloneLanguage(shellStatementSet)]])
  };
}

export function registerOperatorSet(
  registry: Map<string, OperatorSetDefinition>,
  name: string,
  definition: OperatorSetDefinition
): void {
  registerNamedValue(registry, name, definition, "operator set");
}

export function registerCommandSet(
  registry: Map<string, CommandSetDefinition>,
  name: string,
  definition: CommandSetDefinition
): void {
  registerNamedValue(registry, name, definition, "command set");
}

export function registerStatementSet(
  registry: Map<string, Language>,
  name: string,
  definition: Language
): void {
  registerNamedValue(registry, name, definition, "statement set");
}

function registerNamedValue<T>(
  registry: Map<string, T>,
  name: string,
  definition: T,
  kind: string
): void {
  if (registry.has(name)) {
    throw new Error(`Cannot redefine ${kind} '${name}'`);
  }

  registry.set(name, definition);
}