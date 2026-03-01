import { describe, expect, it } from "vitest";
import { createParser } from "../parser/index.js";
import { parseShellLine, parseShellScript } from "../shell/index.js";

describe("parser", () => {
  const parser = createParser({
    prefixOperators: {
      "-": { precedence: 9 }
    },
    infixOperators: {
      "+": { precedence: 7 },
      "*": { precedence: 8 }
    },
    allowAssignmentStatements: true,
    defaultCommand: {
      argumentKind: "expression",
      parseNamedArguments: true
    }
  });

  it("parses command name and arguments", () => {
    const command = parser.parseLine("echo hello");
    expect(command.kind).toBe("command");
    if (command.kind !== "command") throw new Error("expected command");
    expect(command.name).toBe("echo");
    expect(Object.keys(command.args)).toHaveLength(1);
    expect(command.args.arg0 && typeof command.args.arg0 === "object" && "kind" in command.args.arg0 ? command.args.arg0.kind : "").toBe("identifier");
  });

  it("parses assignment statements", () => {
    const statement = parser.parseLine("set = 1 + 2");
    expect(statement.kind).toBe("assignment");
    if (statement.kind !== "assignment") throw new Error("expected assignment");
    expect(statement.name).toBe("set");
    expect(statement.value.kind).toBe("binary");
  });

  it("parses scripts into command list", () => {
    const commands = parser.parseScript("echo one\necho two");
    expect(commands).toHaveLength(2);
  });

  it("uses shell configuration from shell module", () => {
    const statement = parseShellLine("set = 1 + 2");
    expect(statement.kind).toBe("assignment");
    if (statement.kind !== "assignment") throw new Error("expected assignment");
    expect(statement.value.kind).toBe("binary");

    const commands = parseShellScript("echo one\necho two");
    expect(commands).toHaveLength(2);
  });

  it("parses nested-block argument kind", () => {
    const blockParser = createParser({
      prefixOperators: {},
      infixOperators: {},
      defaultCommand: {
        argumentKind: "nested-block",
        parseNamedArguments: false,
        consumeRestAsSingleArgument: true
      }
    });

    const statement = blockParser.parseLine("block { echo hello }");
    expect(statement.kind).toBe("command");
    if (statement.kind !== "command") throw new Error("expected command");

    const value = statement.args.arg0;
    expect(typeof value).not.toBe("string");
    expect(Array.isArray(value)).toBe(false);
    expect(value && typeof value === "object" && "kind" in value ? value.kind : "").toBe("nested-block");

    if (value && typeof value === "object" && "kind" in value && value.kind === "nested-block") {
      expect(value.content).toBe("echo hello");
    }
  });

  it("maps positional varargs to named list", () => {
    const varargParser = createParser({
      prefixOperators: {
        "+": { precedence: 7 }
      },
      infixOperators: {
        "+": { precedence: 7 }
      },
      commands: {
        echo: {
          arguments: [{ name: "extras", kind: "expression", positional: true, vararg: true }]
        }
      }
    });

    const statement = varargParser.parseLine("echo one 2 3+4");
    expect(statement.kind).toBe("command");
    if (statement.kind !== "command") throw new Error("expected command");

    const extras = statement.args.extras;
    expect(Array.isArray(extras)).toBe(true);
    expect((extras as unknown[]).length).toBe(3);
  });
});
