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

export class Language {
  name?: string;
  statements: Record<string, StatementDefinition>;
  defaultStatement?: StatementDefinition;
  strictStatements?: boolean;
  operatorSet: OperatorSetDefinition;
  allowAssignmentStatements?: boolean;

  constructor(
    parts: Pick<Language, "operatorSet" | "statements"> & Partial<Pick<Language, "name" | "defaultStatement" | "strictStatements">>,
    overrides: Partial<Pick<Language, "allowAssignmentStatements">> = {}
  ) {
    this.name = parts.name;
    this.operatorSet = cloneOperatorSet(parts.operatorSet);
    this.statements = cloneStatementDefinitions(parts.statements);
    this.defaultStatement = parts.defaultStatement ? cloneStatementDefinition(parts.defaultStatement) : undefined;
    this.strictStatements = parts.strictStatements;
    this.allowAssignmentStatements = overrides.allowAssignmentStatements;
  }
}

export function createLanguage(
  parts: Pick<Language, "operatorSet" | "statements"> & Partial<Pick<Language, "name" | "defaultStatement" | "strictStatements">>,
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
  language: Pick<Language, "statements" | "strictStatements" | "defaultStatement">
): Pick<ParserConfig, "statements" | "strictStatements" | "defaultStatement"> {
  return {
    statements: cloneStatementDefinitions(language.statements),
    strictStatements: language.strictStatements,
    defaultStatement: language.defaultStatement ? cloneStatementDefinition(language.defaultStatement) : undefined
  };
}

export function toParserConfig(language: Language): ParserConfig {
  return new ParserConfig({
    ...toExpressionParserConfig(language.operatorSet),
    ...toStatementParserDefinition(language),
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
      name: definition.name,
      operatorSet: cloneOperatorSet(definition.operatorSet),
      statements: cloneStatementDefinitions(definition.statements),
      strictStatements: definition.strictStatements,
      defaultStatement: definition.defaultStatement ? cloneStatementDefinition(definition.defaultStatement) : undefined
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
