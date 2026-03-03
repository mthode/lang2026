import { describe, expect, it } from "vitest";
import { ReplEngine } from "../repl/index.js";

describe("repl continuation", () => {
  it("supports backslash line continuation", async () => {
    const engine = new ReplEngine({ execute: () => ({ output: "5" }) });

    const first = await engine.evaluate("eval 2 + \\");
    expect(first.pending).toBe(true);
    expect(first.output).toBeUndefined();

    const second = await engine.evaluate("3");
    expect(second.pending).toBe(false);
    expect(second.output).toBe("5");
  });

  it("supports bracket-based continuation", async () => {
    const engine = new ReplEngine({ execute: () => ({ output: "5" }) });

    const first = await engine.evaluate("eval (2 +");
    expect(first.pending).toBe(true);

    const second = await engine.evaluate("3)");
    expect(second.pending).toBe(false);
    expect(second.output).toBe("5");
  });

  it("delegates execution through callbacks", async () => {
    const engine = new ReplEngine({
      execute: (source) => ({ output: `executed:${source}` })
    });

    const result = await engine.evaluate("any language line");
    expect(result.pending).toBe(false);
    expect(result.output).toBe("executed:any language line");
  });
});
