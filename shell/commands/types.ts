import type { CommandNode, Language, StatementNode } from "../../parser/index.js";
import type { ExpressionRuntimeEnvironment, LangFunctionDefinition } from "../../lang/types.js";
import type { CommandDeclaration } from "../../parser/declaration.js";
import type {
  CommandSetDefinition,
  OperatorSetDefinition
} from "../../parser/index.js";
import { createShellLanguageRegistries } from "../custom-language.js";

export interface ShellEnvironment extends ExpressionRuntimeEnvironment {
  commands: Map<string, UserCommandDefinition>;
  expressionFunctions: Map<string, LangFunctionDefinition>;
  operatorSets: Map<string, OperatorSetDefinition>;
  commandSets: Map<string, CommandSetDefinition>;
  statementSets: Map<string, Language>;
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
  declaration: CommandDeclaration;
}

export function createShellEnvironment(options: ShellEnvironmentOptions = {}): ShellEnvironment {
  const registries = createShellLanguageRegistries();

  return {
    variables: {},
    localVariables: {},
    commands: new Map(),
    expressionFunctions: new Map(),
    operatorSets: registries.operatorSets,
    commandSets: registries.commandSets,
    statementSets: registries.statementSets,
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
  executeStatement(statement: StatementNode, environment: ShellEnvironment): string | undefined;
}

export type ShellCommandExecutor = (
  command: CommandNode,
  context: ShellCommandContext,
  environment: ShellEnvironment
) => string | undefined;
