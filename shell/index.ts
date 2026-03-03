import { createParser, type CommandNode, type ParserConfig, type ParserScope, type StatementNode } from "../parser/index.js";
import { executeEchoCommand } from "./commands/echo.js";
import { executeEvalCommand } from "./commands/eval.js";
import { executeForCommand } from "./commands/for.js";
import { executeCmdCommand, executeUserCommand } from "./commands/command.js";
import { executeIfCommand } from "./commands/if.js";
import { executeWhileCommand } from "./commands/while.js";
import { createShellEnvironment, type ShellCommandContext, type ShellCommandExecutor, type ShellEnvironment } from "./commands/types.js";
import { evaluateShellExpression } from "./utils/expression.js";
export { evaluateShellExpression } from "./utils/expression.js";

const shellParserConfig: ParserConfig = {
  prefixOperators: {
    "+": { precedence: 9 },
    "-": { precedence: 9 },
    "!": { precedence: 9 },
    "~": { precedence: 9 }
  },
  infixOperators: {
    ",": { precedence: 1 },
    "=": { precedence: 2, associativity: "right" },
    "||": { precedence: 3 },
    "&&": { precedence: 4 },
    "==": { precedence: 5 },
    "!=": { precedence: 5 },
    "<": { precedence: 6 },
    ">": { precedence: 6 },
    "<=": { precedence: 6 },
    ">=": { precedence: 6 },
    "+": { precedence: 7 },
    "-": { precedence: 7 },
    "*": { precedence: 8 },
    "/": { precedence: 8 },
    "%": { precedence: 8 }
  },
  allowAssignmentStatements: true,
  defaultCommand: {
    argumentKind: "expression",
    parseNamedArguments: true
  },
  commands: {
    cmd: {
      arguments: [{ name: "declaration", kind: "raw", positional: true, vararg: true }]
    },
    if: {
      arguments: [
        { name: "condition", kind: "expression", positional: true },
        { name: "then", kind: "nested-block" },
        { name: "else", kind: "nested-block", optional: true }
      ]
    },
    while: {
      arguments: [
        { name: "condition", kind: "expression", positional: true },
        { name: "do", kind: "nested-block" }
      ]
    },
    for: {
      arguments: [
        { name: "iterator", kind: "expression", positional: true },
        { name: "from", kind: "expression" },
        { name: "to", kind: "expression" },
        { name: "step", kind: "expression", optional: true },
        { name: "do", kind: "nested-block" }
      ]
    },
    eval: {
      arguments: [{ name: "expression", kind: "expression", positional: true }]
    },
    echo: {
      arguments: [{ name: "extras", kind: "expression", positional: true, vararg: true }]
    },
    raw: {
      arguments: [{ name: "text", kind: "raw", positional: true, vararg: true }]
    }
  }
};

const shellParser = createParser(shellParserConfig);

const commandExecutors: Record<string, ShellCommandExecutor> = {
  cmd: executeCmdCommand,
  eval: executeEvalCommand,
  echo: executeEchoCommand,
  if: executeIfCommand,
  while: executeWhileCommand,
  for: executeForCommand
};

const commandContext: ShellCommandContext = {
  parseScript: (source, scope) => parseShellScript(source, scope),
  parseLine: (source, startLine, scope) => parseShellLine(source, startLine, scope),
  executeStatement: (statement, environment) => executeShellCommand(statement, environment)
};

export type ShellCommandNode = CommandNode;
export type ShellStatementNode = StatementNode;
export const parseShellLine = (source: string, startLine?: number, scope?: ParserScope) =>
  shellParser.parseLine(source, startLine, scope);
export const parseShellScript = (source: string, scope?: ParserScope) => shellParser.parseScript(source, scope);

export function executeShellCommand(statement: ShellStatementNode, environment: ShellEnvironment): string | undefined {
  if (statement.kind === "assignment") {
    const value = evaluateShellExpression(statement.value, environment);
    environment.variables[statement.name] = value;
    return undefined;
  }

  const commandExecutor = commandExecutors[statement.name];
  if (commandExecutor) {
    return commandExecutor(statement, commandContext, environment);
  }

  return executeUserCommand(statement.name, statement.raw, commandContext, environment);
}

export interface ShellRuntime {
  execute(script: string): Promise<void>;
}

export type ShellStatementHandler = (statement: ShellStatementNode) => Promise<void> | void;

export function createShellRuntime(handler: ShellStatementHandler): ShellRuntime {
  return {
    async execute(script: string): Promise<void> {
      const statements = parseShellScript(script);
      for (const statement of statements) {
        await handler(statement);
      }
    }
  };
}

export { createShellEnvironment };
