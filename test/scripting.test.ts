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

  it("runs command definitions from a .script file", async () => {
    let output = "";
    await runScriptFile("test/scripts/command.script", (text) => {
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

  it("runs recursive fibonacci command definitions from a multiline .script file", async () => {
    let output = "";
    await runScriptFile("test/scripts/fibonacci.script", (text) => {
      output += text;
    });

    expect(normalizeOutput(output)).toBe("42\n0\n1\n1\n2\n3\n5");
  });

  it("runs custom language declarations end-to-end from a .script file", async () => {
    let output = "";
    await runScriptFile("test/scripts/custom-language.script", (text) => {
      output += text;
    });

    expect(normalizeOutput(output)).toBe("3");
  });
});
