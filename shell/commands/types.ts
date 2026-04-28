import type { Language, NamedStatementNode, StatementNode } from "../../parser/index.js";
import type { ExpressionRuntimeEnvironment, LangFunctionDefinition } from "../../lang/types.js";
import type { StatementDeclaration } from "../declaration.js";
import type {
  OperatorSetDefinition,
  StatementDefinition,
  StatementSetDefinition
} from "../../parser/index.js";
import { createShellLanguageRegistries } from "../custom-language.js";

export class ShellEnvironment implements ExpressionRuntimeEnvironment {
  variables: Record<string, number> = {};
  localVariables: Record<string, number> = {};
  commands = new Map<string, UserCommandDefinition>();
  statementDeclarations = new Map<string, StatementDefinition>();
  expressionFunctions = new Map<string, LangFunctionDefinition>();
  operatorSets: Map<string, OperatorSetDefinition>;
  statementSets: Map<string, StatementSetDefinition>;
  languages: Map<string, Language>;
  currentDirectory: string;
  executeOsCommand: (command: string, args: string[]) => string | undefined;
  changeDirectory: (path: string, currentDirectory: string) => string;

  constructor(options: ShellEnvironmentOptions = {}) {
    const registries = createShellLanguageRegistries();

    this.operatorSets = registries.operatorSets;
    this.statementSets = registries.statementSets;
    this.languages = registries.languages;
    this.currentDirectory = options.currentDirectory ?? "/";
    this.executeOsCommand = options.executeOsCommand ?? (() => {
      throw new Error("OS commands are not available on the web");
    });
    this.changeDirectory = options.changeDirectory ?? (() => {
      throw new Error("OS commands are not available on the web");
    });
  }
}

export interface ShellEnvironmentOptions {
  currentDirectory?: string;
  executeOsCommand?: (command: string, args: string[]) => string | undefined;
  changeDirectory?: (path: string, currentDirectory: string) => string;
}

export class UserCommandDefinition {
  constructor(
    readonly declaration: StatementDeclaration,
    readonly implementationBody: string,
    readonly bodyLanguageName?: string,
    readonly argumentOperatorSet?: OperatorSetDefinition,
    readonly bodyLanguage?: Language
  ) {}
}

export function createShellEnvironment(options: ShellEnvironmentOptions = {}): ShellEnvironment {
  return new ShellEnvironment(options);
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
