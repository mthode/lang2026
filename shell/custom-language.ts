import {
  cloneLanguage,
  cloneOperatorSet,
  cloneStatementSet,
  createLanguage,
  StatementArgumentDefinition,
  StatementBlockDefinition,
  StatementDefinition,
  type Language,
  type OperatorSetDefinition,
  type StatementSetDefinition
} from "../parser/index.js";
import { expressionConfig } from "../lang/expression-config.js";

export const SHELL_OPERATOR_SET_NAME = "shell_ops";
export const SHELL_STATEMENT_SET_NAME = "shell_statements";
export const SHELL_LANGUAGE_NAME = "shell";

export const shellStatementDefinitions: Record<string, StatementDefinition> = {
  cd: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "path", valueKind: "raw", positional: true, vararg: true })]
  }),
  cmd: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "declaration", valueKind: "raw", positional: true, vararg: true })]
  }),
  eval: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "expression", valueKind: "expression", positional: true })]
  }),
  echo: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "extras", valueKind: "raw", positional: true, vararg: true })]
  }),
  for: new StatementDefinition({
    parts: [
      new StatementArgumentDefinition({ name: "iterator", valueKind: "expression", positional: true }),
      new StatementArgumentDefinition({ name: "from", valueKind: "expression" }),
      new StatementArgumentDefinition({ name: "to", valueKind: "expression" }),
      new StatementArgumentDefinition({ name: "step", valueKind: "expression", optional: true }),
      new StatementBlockDefinition({ name: "do" })
    ]
  }),
  func: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "declaration", valueKind: "raw", positional: true, vararg: true })]
  }),
  if: new StatementDefinition({
    parts: [
      new StatementArgumentDefinition({ name: "condition", valueKind: "expression", positional: true }),
      new StatementBlockDefinition({ name: "then" }),
      new StatementBlockDefinition({ name: "else", optional: true })
    ]
  }),
  language: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "declaration", valueKind: "raw", positional: true, vararg: true })]
  }),
  operators: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "declaration", valueKind: "raw", positional: true, vararg: true })]
  }),
  raw: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "text", valueKind: "raw", positional: true, vararg: true })]
  }),
  statements: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "declaration", valueKind: "raw", positional: true, vararg: true })]
  }),
  stmt: new StatementDefinition({
    parts: [new StatementArgumentDefinition({ name: "declaration", valueKind: "raw", positional: true, vararg: true })]
  }),
  while: new StatementDefinition({
    parts: [
      new StatementArgumentDefinition({ name: "condition", valueKind: "expression", positional: true }),
      new StatementBlockDefinition({ name: "do" })
    ]
  })
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
