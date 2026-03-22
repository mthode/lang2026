import { describe, expect, it } from "vitest";
import { parseShellLine } from "../shell/index.js";
import { translateBuiltInInvocation } from "../shell/commands/builtin-invocation.js";

describe("built-in command declaration migration", () => {
  it("translates eval invocations into expression arguments", () => {
    const statement = parseShellLine("eval 1 + 2 * 3");
    expect(statement.kind).toBe("command");
    if (statement.kind !== "command") throw new Error("expected command");

    const translated = translateBuiltInInvocation(statement);
    expect(translated.args.expression).toMatchObject({ kind: "binary", operator: "+" });
  });

  it("translates for clauses with multi-token expressions", () => {
    const statement = parseShellLine("for i from 1 + 1 to 3 + 1 step 2 - 1 do { echo $i }");
    expect(statement.kind).toBe("command");
    if (statement.kind !== "command") throw new Error("expected command");

    const translated = translateBuiltInInvocation(statement);
    expect(translated.args.iterator).toMatchObject({ kind: "identifier", name: "i" });
    expect(translated.args.from).toMatchObject({ kind: "binary", operator: "+" });
    expect(translated.args.to).toMatchObject({ kind: "binary", operator: "+" });
    expect(translated.args.step).toMatchObject({ kind: "binary", operator: "-" });
    expect(translated.args.do).toMatchObject({ kind: "nested-block", content: "echo $i" });
  });
});
