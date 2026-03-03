import { ReplEngine } from "../repl/index.js";
import { createShellEnvironment, formatShellPrompt } from "../shell/index.js";
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
  const engine = new ReplEngine(undefined, environment);

  try {
    while (true) {
      const line = await io.read(formatShellPrompt(environment));
      if (line.trim() === ".exit") {
        break;
      }

      try {
        const result = await engine.evaluate(line);
        if (result.output) {
          io.write(`${result.output}\n`);
        }
      } catch (error) {
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
