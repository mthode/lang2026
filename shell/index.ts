import { createParser, type NamedStatementNode, type ParserConfig, type Language, type StatementNode } from "../parser/index.js";
import { splitLogicalLinesWithMetadata } from "../scanner/index.js";
import type { ReplCallbacks } from "../repl/index.js";
import { executeEchoCommand } from "./commands/echo.js";
import { executeEvalCommand } from "./commands/eval.js";
import { executeForCommand } from "./commands/for.js";
import { executeCdCommand } from "./commands/cd.js";
import { executeFuncCommand } from "./commands/function.js";
import { executeLanguageCommand, executeOperatorsCommand, executeStatementsCommand } from "./commands/language-object.js";
import { executeCmdCommand, executeUserCommand } from "./commands/command.js";
import { executeIfCommand } from "./commands/if.js";
import { executeStmtCommand } from "./commands/statement.js";
import { executeWhileCommand } from "./commands/while.js";
import { createShellEnvironment, type ShellCommandContext, type ShellCommandExecutor, type ShellEnvironment } from "./commands/types.js";
import { splitArgumentSegments } from "./utils/arguments.js";
import { evaluateLangExpression, substituteStatementVariables } from "../lang/expression.js";
import { getStatementArgumentSource, toParserConfig } from "../parser/index.js";
import { shellLanguage } from "./custom-language.js";
export { evaluateLangExpression as evaluateShellExpression } from "../lang/expression.js";

const shellParserConfig: ParserConfig = toParserConfig(shellLanguage);

const shellParser = createParser(shellParserConfig);

const commandExecutors: Record<string, ShellCommandExecutor> = {
  cd: executeCdCommand,
  cmd: executeCmdCommand,
  func: executeFuncCommand,
  eval: executeEvalCommand,
  echo: executeEchoCommand,
  if: executeIfCommand,
  language: executeLanguageCommand,
  operators: executeOperatorsCommand,
  stmt: executeStmtCommand,
  statements: executeStatementsCommand,
  while: executeWhileCommand,
  for: executeForCommand
};

const commandContext: ShellCommandContext = {
  parseScript: (source, scope) => parseShellScript(source, scope),
  parseLine: (source, environment, startLine, scope) =>
    parseShellLine(substituteStatementVariables(source, environment), startLine, scope),
  executeStatement: (statement, environment, scope) => executeShellCommand(statement, environment, scope)
};

export type ShellCommandNode = NamedStatementNode;
export type ShellStatementNode = StatementNode;
export const parseShellLine = (source: string, startLine?: number, scope?: Language) =>
  shellParser.parseLine(source, startLine, scope);
export const parseShellScript = (source: string, scope?: Language) => shellParser.parseScript(source, scope);
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

export function executeShellSource(source: string, environment: ShellEnvironment, scope?: Language): ShellSourceExecutionResult {
  const statements = splitLogicalLinesWithMetadata(source);
  const outputs: string[] = [];
  let lastCommand: ShellCommandNode | undefined;

  for (const line of statements) {
    const parsed = parseShellLine(substituteStatementVariables(line.content, environment), line.startLine, scope);
    const output = executeShellCommand(parsed, environment, scope);
    if (output !== undefined) {
      outputs.push(output);
    }

    if (parsed.kind === "statement") {
      lastCommand = parsed;
    }
  }

  return {
    command: lastCommand,
    output: outputs.length > 0 ? outputs.join("\n") : undefined
  };
}

export function executeShellCommand(
  statement: ShellStatementNode,
  environment: ShellEnvironment,
  scope?: Language
): string | undefined {
  if (statement.kind === "assignment") {
    const value = evaluateLangExpression(statement.value, environment);
    environment.variables[statement.name] = value;
    return undefined;
  }

  const commandExecutor = commandExecutors[statement.name];
  if (commandExecutor) {
    return commandExecutor(statement, commandContext, environment, scope);
  }

  if (environment.commands.has(statement.name)) {
    return executeUserCommand(statement.name, statement.raw, commandContext, environment);
  }

  if (environment.expressionFunctions.has(statement.name)) {
    throw new Error(`Cannot execute function '${statement.name}' as a command`);
  }

  const remainder = getStatementArgumentSource(statement.raw);
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
