import type { CommandNode, ParserScope, StatementNode } from "../../parser/index.js";

export interface ShellEnvironment {
  variables: Record<string, number>;
  functions: Map<string, UserFunctionDefinition>;
}

export interface UserFunctionDefinition {
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

export function createShellEnvironment(): ShellEnvironment {
  return {
    variables: {},
    functions: new Map()
  };
}

export interface ShellCommandContext {
  parseScript(source: string, scope?: ParserScope): StatementNode[];
  parseLine(source: string, startLine?: number, scope?: ParserScope): StatementNode;
  executeStatement(statement: StatementNode, environment: ShellEnvironment): string | undefined;
}

export type ShellCommandExecutor = (
  command: CommandNode,
  context: ShellCommandContext,
  environment: ShellEnvironment
) => string | undefined;
