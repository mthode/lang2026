import { describe, expect, it } from "vitest";
import { createParser } from "../parser/index.js";
import { parseShellLine, parseShellScript } from "../shell/index.js";
import { parseCommandDeclaration } from "../parser/declaration.js";
import { scan } from "../scanner/index.js";
import { validateDeclaration } from "../parser/declaration.js";

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

  it("includes line and column for token-specific parse errors", () => {
    expect(() => parseShellLine("eval 1 + )")).toThrowError("Line 1, column 10");
  });

  it("includes absolute line numbers when parsing scripts", () => {
    expect(() => parseShellScript("echo ok\neval 1 + )")).toThrowError("Line 2, column 10");
  });

  it("does not duplicate location prefixes in wrapped argument errors", () => {
    try {
      parseShellLine("if a b");
      throw new Error("expected parse error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("Invalid value for argument 'condition': Line 1, column 6: Unexpected token 'b' after expression");
      expect(message).not.toContain("Line 1, column 1: Invalid value for argument 'condition': Line 1, column 6");
    }
  });

  it("supports expression operator overrides per argument", () => {
    const overrideParser = createParser({
      prefixOperators: {},
      infixOperators: {
        "+": { precedence: 7 }
      },
      commands: {
        calc: {
          arguments: [
            {
              name: "expr",
              kind: "expression",
              positional: true,
              expressionOperators: {
                infixOperators: {
                  "*": { precedence: 8 }
                }
              }
            }
          ]
        },
        echo: {
          arguments: [{ name: "expr", kind: "expression", positional: true }]
        }
      },
      strictCommands: true
    });

    const calc = overrideParser.parseLine("calc 1 + 2 * 3");
    expect(calc.kind).toBe("command");
    if (calc.kind !== "command") throw new Error("expected command");

    const expr = calc.args.expr;
    expect(expr && typeof expr === "object" && !Array.isArray(expr) && "kind" in expr ? expr.kind : "").toBe("binary");
    if (expr && typeof expr === "object" && !Array.isArray(expr) && "kind" in expr && expr.kind === "binary") {
      expect(expr.operator).toBe("+");
      expect(expr.right.kind).toBe("binary");
      if (expr.right.kind === "binary") {
        expect(expr.right.operator).toBe("*");
      }
    }

    expect(() => overrideParser.parseLine("echo 2 * 3")).toThrowError("Unexpected token '*'");
  });

  it("inherits command scope for nested blocks by default", () => {
    const nestedParser = createParser({
      prefixOperators: {},
      infixOperators: {},
      commands: {
        outer: {
          arguments: [{ name: "body", kind: "nested-block", positional: true }]
        },
        inner: {
          arguments: []
        }
      },
      strictCommands: true
    });

    const outer = nestedParser.parseLine("outer { inner }");
    expect(outer.kind).toBe("command");
    if (outer.kind !== "command") throw new Error("expected command");

    const body = outer.args.body;
    expect(body && typeof body === "object" && !Array.isArray(body) && "kind" in body ? body.kind : "").toBe("nested-block");

    if (!body || typeof body !== "object" || Array.isArray(body) || !("kind" in body) || body.kind !== "nested-block") {
      throw new Error("expected nested block");
    }

    const nested = nestedParser.parseLine(body.content, 1, body.scope);
    expect(nested.kind).toBe("command");
    if (nested.kind !== "command") throw new Error("expected command");
    expect(nested.name).toBe("inner");
  });

  it("supports custom command scope for nested blocks", () => {
    const nestedParser = createParser({
      prefixOperators: {},
      infixOperators: {},
      commands: {
        outer: {
          arguments: [
            {
              name: "body",
              kind: "nested-block",
              positional: true,
              nestedScope: {
                commands: {
                  only: { arguments: [] }
                },
                strictCommands: true
              }
            }
          ]
        },
        inner: {
          arguments: []
        }
      },
      strictCommands: true
    });

    const outer = nestedParser.parseLine("outer { only }");
    expect(outer.kind).toBe("command");
    if (outer.kind !== "command") throw new Error("expected command");

    const body = outer.args.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || !("kind" in body) || body.kind !== "nested-block") {
      throw new Error("expected nested block");
    }

    const nested = nestedParser.parseLine(body.content, 1, body.scope);
    expect(nested.kind).toBe("command");
    if (nested.kind !== "command") throw new Error("expected command");
    expect(nested.name).toBe("only");

    expect(() => nestedParser.parseLine("inner", 1, body.scope)).toThrowError("Unknown command 'inner'");
  });
});

describe("parseCommandDeclaration", () => {
  function declarationTokens(source: string) {
    const tokens = scan(source);
    const cmdIndex = tokens.findIndex((token) => token.type === "identifier" && token.value === "cmd");
    if (cmdIndex < 0) {
      throw new Error("expected cmd declaration in test input");
    }
    return tokens.slice(cmdIndex + 1);
  }

  it("parses command with no arguments", () => {
    const decl = parseCommandDeclaration(declarationTokens("cmd noop { echo hi }"));

    expect(decl.name).toBe("noop");
    expect(decl.qualifiers).toEqual([]);
    expect(decl.argDecls).toEqual({ positional: [], keyedClauses: [], vararg: undefined });
    expect(decl.body.content).toBe("echo hi");
    expect([...decl.globalKeywords]).toEqual([]);
  });

  it("parses positional args, optional args, keyed clauses, and vararg trailing names", () => {
    const decl = parseCommandDeclaration(declarationTokens("cmd verbose? cp _ src? (to _) [mode name]* ... destination { echo hi }"));

    expect(decl.name).toBe("cp");
    expect(decl.qualifiers).toEqual([{ keyword: "verbose" }]);
    expect(decl.argDecls.positional).toEqual([
      { kind: "unnamed", name: undefined, optional: false },
      { kind: "named", name: "src", optional: true }
    ]);
    expect(decl.argDecls.keyedClauses).toHaveLength(2);
    expect(decl.argDecls.keyedClauses[0]).toMatchObject({ keyword: "to", required: true, allowMultiple: false });
    expect(decl.argDecls.keyedClauses[1]).toMatchObject({ keyword: "mode", required: false, allowMultiple: true });
    expect(decl.argDecls.vararg).toEqual({ trailingNamedArgs: ["destination"] });
    expect([...decl.globalKeywords]).toEqual(["to", "mode"]);
  });

  it("parses nested keyed clauses", () => {
    const decl = parseCommandDeclaration(declarationTokens("cmd move (from _ (within _)) (to _) { echo hi }"));

    expect(decl.argDecls.keyedClauses).toHaveLength(2);
    const fromClause = decl.argDecls.keyedClauses[0];
    expect(fromClause?.keyword).toBe("from");
    expect(fromClause?.argDecls.keyedClauses).toHaveLength(1);
    expect(fromClause?.argDecls.keyedClauses[0]?.keyword).toBe("within");
    expect([...decl.globalKeywords]).toEqual(["from", "within", "to"]);
  });

  it("throws for duplicate keyed clause keywords", () => {
    expect(() =>
      parseCommandDeclaration(declarationTokens("cmd broken (to _) [to _] { echo hi }"))
    ).toThrowError("Duplicate keyed clause keyword 'to'");
  });

  it("throws for invalid quantifier placement", () => {
    expect(() =>
      parseCommandDeclaration(declarationTokens("cmd broken (to _)* { echo hi }"))
    ).toThrowError("Invalid quantifier '*'");

    expect(() =>
      parseCommandDeclaration(declarationTokens("cmd broken [to _]+ { echo hi }"))
    ).toThrowError("Invalid quantifier '+'");
  });

  it("throws when there is content after the body", () => {
    expect(() =>
      parseCommandDeclaration(declarationTokens("cmd broken { echo hi } trailing"))
    ).toThrowError("Unexpected content after command body");
  });

  it("validateDeclaration rejects qualifier colliding with existing command name", () => {
    const decl = parseCommandDeclaration(declarationTokens("cmd verbose? cp { }"));
    expect(() => validateDeclaration(decl, new Set(["verbose"]))).toThrowError("Qualifier keyword 'verbose' collides with existing command name");
  });

  it("validateDeclaration rejects qualifier colliding with keyed clause keyword", () => {
    const decl = parseCommandDeclaration(declarationTokens("cmd verbose? cp (verbose _) { }"));
    expect(() => validateDeclaration(decl, new Set())).toThrowError("Qualifier keyword 'verbose' collides with a keyed clause keyword");
  });

  it("validateDeclaration rejects nested vararg when ancestor has trailing named args", () => {
    const decl = parseCommandDeclaration(declarationTokens("cmd bad _ (child (sub ...)) ... dest { echo }"));
    expect(() => validateDeclaration(decl, new Set())).toThrowError("Nested keyword clauses cannot contain '...' when a higher-level clause contains trailing required positional declarations");
  });
});
