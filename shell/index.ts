import { createParser, type CommandNode, type ParserConfig, type ParserDefinition, type StatementNode } from "../parser/index.js";
import { splitLogicalLinesWithMetadata } from "../scanner/index.js";
import type { ReplCallbacks } from "../repl/index.js";
import { executeEchoCommand } from "./commands/echo.js";
import { executeEvalCommand } from "./commands/eval.js";
import { executeForCommand } from "./commands/for.js";
import { executeCdCommand } from "./commands/cd.js";
import { executeFuncCommand } from "./commands/function.js";
import { executeCmdCommand, executeUserCommand } from "./commands/command.js";
import { executeIfCommand } from "./commands/if.js";
import { executeWhileCommand } from "./commands/while.js";
import { createShellEnvironment, type ShellCommandContext, type ShellCommandExecutor, type ShellEnvironment } from "./commands/types.js";
import { expressionConfig } from "../lang/expression-config.js";
import { splitArgumentSegments } from "./utils/arguments.js";
import { evaluateLangExpression, substituteStatementVariables } from "../lang/expression.js";
import { getCommandArgumentSource } from "../parser/index.js";
export { evaluateLangExpression as evaluateShellExpression } from "../lang/expression.js";

const shellParserConfig: ParserConfig = {
  ...expressionConfig,
  allowAssignmentStatements: true,
  defaultCommand: {
    argumentKind: "raw",
    parseNamedArguments: false
  },
  commands: {
    cd: {
      arguments: [{ name: "path", kind: "raw", positional: true, vararg: true }]
    },
    cmd: {
      arguments: [{ name: "declaration", kind: "raw", positional: true, vararg: true }]
    },
    func: {
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
  cd: executeCdCommand,
  cmd: executeCmdCommand,
  func: executeFuncCommand,
  eval: executeEvalCommand,
  echo: executeEchoCommand,
  if: executeIfCommand,
  while: executeWhileCommand,
  for: executeForCommand
};

const commandContext: ShellCommandContext = {
  parseScript: (source, scope) => parseShellScript(source, scope),
  parseLine: (source, environment, startLine, scope) =>
    parseShellLine(substituteStatementVariables(source, environment), startLine, scope),
  executeStatement: (statement, environment) => executeShellCommand(statement, environment)
};

export type ShellCommandNode = CommandNode;
export type ShellStatementNode = StatementNode;
export const parseShellLine = (source: string, startLine?: number, scope?: ParserDefinition) =>
  shellParser.parseLine(source, startLine, scope);
export const parseShellScript = (source: string, scope?: ParserDefinition) => shellParser.parseScript(source, scope);
export const formatShellPrompt = (environment: ShellEnvironment): string => `${environment.currentDirectory}> `;

export interface ShellSourceExecutionResult {
  command?: ShellCommandNode;
  output?: string;
}

export function createShellReplCallbacks(environment: ShellEnvironment): ReplCallbacks<ShellCommandNode> {
  return {
    execute: (source) => executeShellSource(source, environment)
  };
}

export function executeShellSource(source: string, environment: ShellEnvironment, scope?: ParserDefinition): ShellSourceExecutionResult {
  const statements = splitLogicalLinesWithMetadata(source);
  const outputs: string[] = [];
  let lastCommand: ShellCommandNode | undefined;

  for (const line of statements) {
    const parsed = parseShellLine(substituteStatementVariables(line.content, environment), line.startLine, scope);
    const output = executeShellCommand(parsed, environment);
    if (output !== undefined) {
      outputs.push(output);
    }

    if (parsed.kind === "command") {
      lastCommand = parsed;
    }
  }

  return {
    command: lastCommand,
    output: outputs.length > 0 ? outputs.join("\n") : undefined
  };
}

export function executeShellCommand(statement: ShellStatementNode, environment: ShellEnvironment): string | undefined {
  if (statement.kind === "assignment") {
    const value = evaluateLangExpression(statement.value, environment);
    environment.variables[statement.name] = value;
    return undefined;
  }

  const commandExecutor = commandExecutors[statement.name];
  if (commandExecutor) {
    return commandExecutor(statement, commandContext, environment);
  }

  if (environment.commands.has(statement.name)) {
    return executeUserCommand(statement.name, statement.raw, commandContext, environment);
  }

  if (environment.expressionFunctions.has(statement.name)) {
    throw new Error(`Cannot execute function '${statement.name}' as a command`);
  }

  const remainder = getCommandArgumentSource(statement.raw);
  const args = splitArgumentSegments(remainder, { decodeStringLiterals: true });
  return environment.executeOsCommand(statement.name, args);
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
