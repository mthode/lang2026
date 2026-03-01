import { describe, expect, it } from "vitest";
import { runScriptFile } from "../terminal/run-script.js";

function normalizeOutput(output: string): string {
  return output.replace(/\r\n/g, "\n").trim();
}

describe("scripting", () => {
  it("runs a basic .script file", async () => {
    let output = "";
    await runScriptFile("test/scripts/basic.script", (text) => {
      output += text;
    });

    expect(normalizeOutput(output)).toBe("hello script\n12");
  });

  it("runs function definitions from a .script file", async () => {
    let output = "";
    await runScriptFile("test/scripts/function.script", (text) => {
      output += text;
    });

    expect(normalizeOutput(output)).toBe("25");
  });

  it("runs loop commands from a .script file", async () => {
    let output = "";
    await runScriptFile("test/scripts/loops.script", (text) => {
      output += text;
    });

    expect(normalizeOutput(output)).toBe("0\n1\n2\n1\n2\n3");
  });
});
