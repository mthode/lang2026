import { describe, expect, it } from "vitest";
import { ReplEngine, type ReplCallbacks } from "../repl/index.js";

describe("repl continuation", () => {
  it("throws a clear error when callbacks are missing", () => {
    expect(() => new ReplEngine(undefined as unknown as ReplCallbacks)).toThrow(
      "ReplEngine requires callbacks with an execute(source) function"
    );
  });

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

  it("stores each executed command in history", async () => {
    const engine = new ReplEngine({ execute: () => ({ output: "ok" }) });

    await engine.evaluate("echo one");
    await engine.evaluate("echo two");

    expect(engine.getHistory()).toEqual(["echo one", "echo two"]);
  });

  it("stores a multi-line continued command as one history entry", async () => {
    const engine = new ReplEngine({ execute: () => ({ output: "ok" }) });

    const first = await engine.evaluate("eval (1 +");
    expect(first.pending).toBe(true);

    await engine.evaluate("2)");

    expect(engine.getHistory()).toEqual(["eval (1 +\n2)"]);
  });

  it("navigates history with up/down and restores draft input", async () => {
    const engine = new ReplEngine({ execute: () => ({ output: "ok" }) });

    await engine.evaluate("echo first");
    await engine.evaluate("echo second");

    expect(engine.navigateHistory("up", "")).toBe("echo second");
    expect(engine.navigateHistory("up", "")).toBe("echo first");
    expect(engine.navigateHistory("up", "")).toBe("echo first");

    expect(engine.navigateHistory("down", "")).toBe("echo second");
    expect(engine.navigateHistory("down", "")).toBe("");
    expect(engine.navigateHistory("down", "")).toBe("");
  });

  it("returns current input when history is empty", () => {
    const engine = new ReplEngine({ execute: () => ({ output: "ok" }) });

    expect(engine.navigateHistory("up", "draft")).toBe("draft");
    expect(engine.navigateHistory("down", "draft")).toBe("draft");
  });
});
