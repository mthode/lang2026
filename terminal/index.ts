import { ReplEngine } from "../repl/index.js";
import { createShellEnvironment, createShellReplCallbacks, formatShellPrompt } from "../shell/index.js";
import { executeNodeOsCommand, resolveNodeDirectory } from "./os-command.js";

export interface TerminalIo {
  read(prompt: string): Promise<string>;
  write(text: string): void;
  close(): void;
}

export async function startTerminalRepl(io: TerminalIo): Promise<void> {
  const environment = createShellEnvironment({
    currentDirectory: process.cwd(),
    executeOsCommand: (command, args) => executeNodeOsCommand(command, args, environment.currentDirectory),
    changeDirectory: (path, currentDirectory) => resolveNodeDirectory(path, currentDirectory)
  });
  const engine = new ReplEngine(createShellReplCallbacks(environment));
  let continuationLevel = 0;

  try {
    while (true) {
      const prompt = continuationLevel > 0 ? `${"+".repeat(continuationLevel)}> ` : formatShellPrompt(environment);
      const line = await io.read(prompt);
      if (line.trim() === ".exit") {
        break;
      }

      try {
        const result = await engine.evaluate(line);
        continuationLevel = result.pending ? engine.getContinuationLevel() : 0;
        if (result.output) {
          io.write(`${result.output}\n`);
        }
      } catch (error) {
        continuationLevel = 0;
        if (error instanceof Error) {
          io.write(`${error.message}\n`);
          io.write(`${error.stack ?? error.message}\n`);
        } else {
          const message = String(error);
          io.write(`${message}\n`);
          io.write(`${message}\n`);
        }
      }
    }
  } finally {
    io.close();
  }
}
