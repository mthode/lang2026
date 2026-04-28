import { ParserConfig, type StatementDefinition } from "./statement.js";
import {
  ExpressionParserConfig,
  type InfixOperatorDefinition,
  type PrefixOperatorDefinition
} from "./expression.js";

export class OperatorSetDefinition {
  name?: string;
  prefixOperators: Record<string, PrefixOperatorDefinition>;
  infixOperators: Record<string, InfixOperatorDefinition>;

  constructor(definition: OperatorSetDefinition) {
    this.name = definition.name;
    this.prefixOperators = definition.prefixOperators;
    this.infixOperators = definition.infixOperators;
  }
}

export class StatementSetDefinition {
  name?: string;
  statements: Record<string, StatementDefinition>;
  defaultStatement?: StatementDefinition;
  strictStatements?: boolean;

  constructor(definition: StatementSetDefinition) {
    this.name = definition.name;
    this.statements = definition.statements;
    this.defaultStatement = definition.defaultStatement;
    this.strictStatements = definition.strictStatements;
  }
}

export class Language {
  statementSet: StatementSetDefinition;
  operatorSet: OperatorSetDefinition;
  allowAssignmentStatements?: boolean;

  constructor(
    parts: Pick<Language, "statementSet" | "operatorSet">,
    overrides: Partial<Pick<Language, "allowAssignmentStatements">> = {}
  ) {
    this.operatorSet = cloneOperatorSet(parts.operatorSet);
    this.statementSet = cloneStatementSet(parts.statementSet);
    this.allowAssignmentStatements = overrides.allowAssignmentStatements;
  }
}

export function createLanguage(
  parts: Pick<Language, "statementSet" | "operatorSet">,
  overrides: Partial<Pick<Language, "allowAssignmentStatements">> = {}
): Language {
  return new Language(parts, overrides);
}

export function toExpressionParserConfig(operatorSet: OperatorSetDefinition): ExpressionParserConfig {
  return new ExpressionParserConfig(
    { ...operatorSet.prefixOperators },
    { ...operatorSet.infixOperators }
  );
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
  return new ParserConfig({
    ...toExpressionParserConfig(language.operatorSet),
    ...toStatementParserDefinition(language.statementSet),
    ...(language.allowAssignmentStatements !== undefined
      ? { allowAssignmentStatements: language.allowAssignmentStatements }
      : {})
  });
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
  return new Language(
    {
      operatorSet: cloneOperatorSet(definition.operatorSet),
      statementSet: cloneStatementSet(definition.statementSet)
    },
    definition.allowAssignmentStatements !== undefined
      ? { allowAssignmentStatements: definition.allowAssignmentStatements }
      : {}
  );
}

export function cloneOperatorSet(definition: OperatorSetDefinition): OperatorSetDefinition {
  return new OperatorSetDefinition({
    name: definition.name,
    prefixOperators: { ...definition.prefixOperators },
    infixOperators: { ...definition.infixOperators }
  });
}

export function cloneStatementSet(definition: StatementSetDefinition): StatementSetDefinition {
  return new StatementSetDefinition({
    name: definition.name,
    statements: cloneStatementDefinitions(definition.statements),
    strictStatements: definition.strictStatements,
    defaultStatement: definition.defaultStatement ? cloneStatementDefinition(definition.defaultStatement) : undefined
  });
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
