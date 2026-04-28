import type { Language, NamedStatementNode, StatementNode } from "../../parser/index.js";
import type { ExpressionRuntimeEnvironment, LangFunctionDefinition } from "../../lang/types.js";
import type { StatementDeclaration } from "../declaration.js";
import type {
  OperatorSetDefinition,
  StatementDefinition,
  StatementSetDefinition
} from "../../parser/index.js";
import { createShellLanguageRegistries } from "../custom-language.js";

export interface ShellEnvironment extends ExpressionRuntimeEnvironment {
  commands: Map<string, UserCommandDefinition>;
  statementDeclarations: Map<string, StatementDefinition>;
  expressionFunctions: Map<string, LangFunctionDefinition>;
  operatorSets: Map<string, OperatorSetDefinition>;
  statementSets: Map<string, StatementSetDefinition>;
  languages: Map<string, Language>;
  currentDirectory: string;
  executeOsCommand(command: string, args: string[]): string | undefined;
  changeDirectory(path: string, currentDirectory: string): string;
}

export interface ShellEnvironmentOptions {
  currentDirectory?: string;
  executeOsCommand?: (command: string, args: string[]) => string | undefined;
  changeDirectory?: (path: string, currentDirectory: string) => string;
}

export interface UserCommandDefinition {
  declaration: StatementDeclaration;
  implementationBody: string;
  bodyLanguageName?: string;
  argumentOperatorSet?: OperatorSetDefinition;
  bodyLanguage?: Language;
}

export function createShellEnvironment(options: ShellEnvironmentOptions = {}): ShellEnvironment {
  const registries = createShellLanguageRegistries();

  return {
    variables: {},
    localVariables: {},
    commands: new Map(),
    statementDeclarations: new Map(),
    expressionFunctions: new Map(),
    operatorSets: registries.operatorSets,
    statementSets: registries.statementSets,
    languages: registries.languages,
    currentDirectory: options.currentDirectory ?? "/",
    executeOsCommand: options.executeOsCommand ?? (() => {
      throw new Error("OS commands are not available on the web");
    }),
    changeDirectory: options.changeDirectory ?? (() => {
      throw new Error("OS commands are not available on the web");
    })
  };
}

export interface ShellCommandContext {
  parseScript(source: string, scope?: Language): StatementNode[];
  parseLine(source: string, environment: ShellEnvironment, startLine?: number, scope?: Language): StatementNode;
  executeStatement(statement: StatementNode, environment: ShellEnvironment, scope?: Language): string | undefined;
}

export type ShellCommandExecutor = (
  command: NamedStatementNode,
  context: ShellCommandContext,
  environment: ShellEnvironment,
  scope?: Language
) => string | undefined;
