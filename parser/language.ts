import type { ParserConfig, StatementDefinition } from "./statement.js";
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

export interface StatementSetDefinition {
  name?: string;
  statements: Record<string, StatementDefinition>;
  defaultStatement?: StatementDefinition;
  strictStatements?: boolean;
}

export interface Language {
  statementSet: StatementSetDefinition;
  operatorSet: OperatorSetDefinition;
  allowAssignmentStatements?: boolean;
}

export function createLanguage(
  parts: Pick<Language, "statementSet" | "operatorSet">,
  overrides: Partial<Pick<Language, "allowAssignmentStatements">> = {}
): Language {
  return {
    operatorSet: cloneOperatorSet(parts.operatorSet),
    statementSet: cloneStatementSet(parts.statementSet),
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

export function toStatementParserDefinition(
  statementSet: StatementSetDefinition
): Pick<ParserConfig, "statements" | "strictStatements" | "defaultStatement"> {
  return {
    statements: cloneStatementDefinitions(statementSet.statements),
    strictStatements: statementSet.strictStatements,
    defaultStatement: statementSet.defaultStatement ? cloneStatementDefinition(statementSet.defaultStatement) : undefined
  };
}

export function toParserConfig(language: Language): ParserConfig {
  return {
    ...toExpressionParserConfig(language.operatorSet),
    ...toStatementParserDefinition(language.statementSet),
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

export function resolveNamedStatementSet(
  registry: ReadonlyMap<string, StatementSetDefinition>,
  name: string
): StatementSetDefinition {
  const definition = registry.get(name);
  if (!definition) {
    throw new Error(`Unknown statement set '${name}'`);
  }

  return cloneStatementSet(definition);
}

export function resolveNamedLanguage(
  registry: ReadonlyMap<string, Language>,
  name: string
): Language {
  const definition = registry.get(name);
  if (!definition) {
    throw new Error(`Unknown language '${name}'`);
  }

  return cloneLanguage(definition);
}

export function cloneLanguage(definition: Language): Language {
  return {
    operatorSet: cloneOperatorSet(definition.operatorSet),
    statementSet: cloneStatementSet(definition.statementSet),
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

export function cloneStatementSet(definition: StatementSetDefinition): StatementSetDefinition {
  return {
    ...(definition.name !== undefined ? { name: definition.name } : {}),
    statements: cloneStatementDefinitions(definition.statements),
    strictStatements: definition.strictStatements,
    defaultStatement: definition.defaultStatement ? cloneStatementDefinition(definition.defaultStatement) : undefined
  };
}

function cloneStatementDefinitions(
  definitions: Record<string, StatementDefinition>
): Record<string, StatementDefinition> {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [name, cloneStatementDefinition(definition)])
  );
}

function cloneStatementDefinition(definition: StatementDefinition): StatementDefinition {
  return definition;
}
