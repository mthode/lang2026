import { evaluateLangExpression } from "../../lang/expression.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeEvalCommand: ShellCommandExecutor = (command, _context, environment) => {
  const argument = command.args.expression;
  if (!argument || typeof argument === "string" || Array.isArray(argument) || argument.kind === "nested-block") {
    throw new Error("'eval' requires a single expression argument");
  }

  const value = evaluateLangExpression(argument, environment);
  return String(value);
};
