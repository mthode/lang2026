import { ReplEngine } from "../repl/index.js";

export interface TerminalIo {
  read(prompt: string): Promise<string>;
  write(text: string): void;
  close(): void;
}

export async function startTerminalRepl(io: TerminalIo): Promise<void> {
  const engine = new ReplEngine();

  try {
    while (true) {
      const line = await io.read("> ");
      if (line.trim() === ".exit") {
        break;
      }

      const result = await engine.evaluate(line);
      if (result.output) {
        io.write(`${result.output}\n`);
      }
    }
  } finally {
    io.close();
  }
}
