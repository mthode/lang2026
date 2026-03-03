import { describe, expect, it } from "vitest";
import { startTerminalRepl } from "../terminal/index.js";

class FakeIo {
  readonly prompts: string[] = [];
  output = "";
  closed = false;

  constructor(private readonly inputs: string[]) {}

  async read(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    return this.inputs.shift() ?? ".exit";
  }

  write(text: string): void {
    this.output += text;
  }

  close(): void {
    this.closed = true;
  }
}

describe("terminal repl", () => {
  it("prints error message and stack trace, then continues prompting", async () => {
    const missingCommand = "definitely_not_a_real_command_123456789";
    const io = new FakeIo([missingCommand, ".exit"]);

    await startTerminalRepl(io);

    expect(io.closed).toBe(true);
    expect(io.prompts.length).toBe(2);
    expect(io.output).toContain(`OS command not found: ${missingCommand}`);
    expect(io.output).toContain("at ");
  });
});
