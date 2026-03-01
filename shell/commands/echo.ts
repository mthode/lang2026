import type { ArgumentValue } from "../../parser/index.js";
import { stringifyExpression } from "../utils/expression.js";
import type { ShellCommandExecutor } from "./types.js";

function stringifyEchoValue(value: ArgumentValue): string {
  if (typeof value === "string") {
    return value;
  }

  if (value.kind === "nested-block") {
    return value.content;
  }

  return stringifyExpression(value);
}

export const executeEchoCommand: ShellCommandExecutor = (command) => {
  const extras = command.args.extras;
  const values = Array.isArray(extras)
    ? extras.map((value) => stringifyEchoValue(value))
    : extras !== undefined
      ? [stringifyEchoValue(extras)]
      : [];

  return values.join(" ");
};
