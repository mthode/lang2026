import { describe, expect, it } from "vitest";
import { ReplEngine } from "../repl/index.js";

describe("repl continuation", () => {
  it("supports backslash line continuation", async () => {
    const engine = new ReplEngine();

    const first = await engine.evaluate("eval 2 + \\");
    expect(first.pending).toBe(true);
    expect(first.output).toBeUndefined();

    const second = await engine.evaluate("3");
    expect(second.pending).toBe(false);
    expect(second.output).toBe("5");
  });

  it("supports bracket-based continuation", async () => {
    const engine = new ReplEngine();

    const first = await engine.evaluate("eval (2 +");
    expect(first.pending).toBe(true);

    const second = await engine.evaluate("3)");
    expect(second.pending).toBe(false);
    expect(second.output).toBe("5");
  });
});
