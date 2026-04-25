import { getStatementArgumentSource } from "../../parser/index.js";
import { splitArgumentSegments } from "../utils/arguments.js";
import type { ShellCommandExecutor } from "./types.js";

export const executeCdCommand: ShellCommandExecutor = (command, _context, environment) => {
  const fromTranslated = typeof command.args.path === "string" ? [command.args.path] : undefined;
  const remainder = getStatementArgumentSource(command.raw);
  const args = fromTranslated ?? splitArgumentSegments(remainder, { decodeStringLiterals: true });

  if (args.length === 0) {
    throw new Error("'cd' requires a target path");
  }

  if (args.length > 1) {
    throw new Error("'cd' accepts exactly one path argument");
  }

  const nextDirectory = environment.changeDirectory(args[0] ?? "", environment.currentDirectory);
  environment.currentDirectory = nextDirectory;
  return undefined;
};
