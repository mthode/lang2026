import type { CommandNode, ParserDefinition, StatementNode } from "../../parser/index.js";
import type { ExpressionRuntimeEnvironment, LangFunctionDefinition } from "../../lang/types.js";

export interface ShellEnvironment extends ExpressionRuntimeEnvironment {
  commands: Map<string, UserCommandDefinition>;
  expressionFunctions: Map<string, LangFunctionDefinition>;
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
  name: string;
  declarations: Array<
    | {
        name: string;
        optional: boolean;
        mode: "positional";
      }
    | {
        name: string;
        optional: boolean;
        mode: "named";
        valueCount: number;
      }
  >;
  body: string;
}

export function createShellEnvironment(options: ShellEnvironmentOptions = {}): ShellEnvironment {
  return {
    variables: {},
    localVariables: {},
    commands: new Map(),
    expressionFunctions: new Map(),
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
  parseScript(source: string, scope?: ParserDefinition): StatementNode[];
  parseLine(source: string, environment: ShellEnvironment, startLine?: number, scope?: ParserDefinition): StatementNode;
  executeStatement(statement: StatementNode, environment: ShellEnvironment): string | undefined;
}

export type ShellCommandExecutor = (
  command: CommandNode,
  context: ShellCommandContext,
  environment: ShellEnvironment
) => string | undefined;
