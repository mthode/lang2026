import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { startTerminalRepl, type TerminalIo } from "./index.js";

class NodeTerminalIo implements TerminalIo {
  private readonly rl = readline.createInterface({ input, output });

  read(prompt: string): Promise<string> {
    return this.rl.question(prompt);
  }

  write(text: string): void {
    output.write(text);
  }

  close(): void {
    this.rl.close();
  }
}

await startTerminalRepl(new NodeTerminalIo());
