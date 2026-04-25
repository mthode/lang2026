import {
  cloneLanguage,
  cloneOperatorSet,
  cloneStatementSet,
  createLanguage,
  type Language,
  type OperatorSetDefinition,
  type StatementDefinition,
  type StatementSetDefinition
} from "../parser/index.js";
import { expressionConfig } from "../lang/expression-config.js";

export const SHELL_OPERATOR_SET_NAME = "shell_ops";
export const SHELL_STATEMENT_SET_NAME = "shell_statements";
export const SHELL_LANGUAGE_NAME = "shell";

export const shellStatementDefinitions: Record<string, StatementDefinition> = {
  cd: {
    parts: [{ kind: "argument", name: "path", valueKind: "raw", positional: true, vararg: true }]
  },
  cmd: {
    parts: [{ kind: "argument", name: "declaration", valueKind: "raw", positional: true, vararg: true }]
  },
  eval: {
    parts: [{ kind: "argument", name: "expression", valueKind: "expression", positional: true }]
  },
  echo: {
    parts: [{ kind: "argument", name: "extras", valueKind: "raw", positional: true, vararg: true }]
  },
  for: {
    parts: [
      { kind: "argument", name: "iterator", valueKind: "expression", positional: true },
      { kind: "argument", name: "from", valueKind: "expression" },
      { kind: "argument", name: "to", valueKind: "expression" },
      { kind: "argument", name: "step", valueKind: "expression", optional: true },
      { kind: "block", name: "do" }
    ]
  },
  func: {
    parts: [{ kind: "argument", name: "declaration", valueKind: "raw", positional: true, vararg: true }]
  },
  if: {
    parts: [
      { kind: "argument", name: "condition", valueKind: "expression", positional: true },
      { kind: "block", name: "then" },
      { kind: "block", name: "else", optional: true }
    ]
  },
  language: {
    parts: [{ kind: "argument", name: "declaration", valueKind: "raw", positional: true, vararg: true }]
  },
  operators: {
    parts: [{ kind: "argument", name: "declaration", valueKind: "raw", positional: true, vararg: true }]
  },
  raw: {
    parts: [{ kind: "argument", name: "text", valueKind: "raw", positional: true, vararg: true }]
  },
  statements: {
    parts: [{ kind: "argument", name: "declaration", valueKind: "raw", positional: true, vararg: true }]
  },
  stmt: {
    parts: [{ kind: "argument", name: "declaration", valueKind: "raw", positional: true, vararg: true }]
  },
  while: {
    parts: [
      { kind: "argument", name: "condition", valueKind: "expression", positional: true },
      { kind: "block", name: "do" }
    ]
  }
};

export const shellOperatorSet: OperatorSetDefinition = {
  name: SHELL_OPERATOR_SET_NAME,
  prefixOperators: { ...expressionConfig.prefixOperators },
  infixOperators: { ...expressionConfig.infixOperators }
};

export const shellStatementSet: StatementSetDefinition = {
  ...cloneStatementSet({
    name: SHELL_STATEMENT_SET_NAME,
    statements: shellStatementDefinitions,
    defaultStatement: {
      argumentKind: "raw",
      parseNamedArguments: false
    }
  })
};

export const shellLanguage: Language = createLanguage({
  statementSet: shellStatementSet,
  operatorSet: shellOperatorSet
}, {
  allowAssignmentStatements: true
});

export function createShellLanguageRegistries(): {
  operatorSets: Map<string, OperatorSetDefinition>;
  statementSets: Map<string, StatementSetDefinition>;
  languages: Map<string, Language>;
} {
  return {
    operatorSets: new Map([[SHELL_OPERATOR_SET_NAME, cloneOperatorSet(shellOperatorSet)]]),
    statementSets: new Map([[SHELL_STATEMENT_SET_NAME, cloneStatementSet(shellStatementSet)]]),
    languages: new Map([[SHELL_LANGUAGE_NAME, cloneLanguage(shellLanguage)]])
  };
}

export function registerOperatorSet(
  registry: Map<string, OperatorSetDefinition>,
  name: string,
  definition: OperatorSetDefinition
): void {
  registerNamedValue(registry, name, definition, "operator set");
}

export function registerStatementSet(
  registry: Map<string, StatementSetDefinition>,
  name: string,
  definition: StatementSetDefinition
): void {
  registerNamedValue(registry, name, definition, "statement set");
}

export function registerLanguage(
  registry: Map<string, Language>,
  name: string,
  definition: Language
): void {
  registerNamedValue(registry, name, definition, "language");
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
