import { describe, expect, it } from "vitest";
import { createParser } from "../parser/index.js";
import { parseShellLine, parseShellScript } from "../shell/index.js";
import { parseCommandDeclaration } from "../parser/declaration.js";
import { scan } from "../scanner/index.js";
import { validateDeclaration } from "../parser/declaration.js";
import { parseInvocation, validateInvocation } from "../parser/invocation.js";
import { createLanguage, toCommandParserDefinition, toExpressionParserConfig, toParserConfig } from "../parser/language.js";
import type { CommandSetDefinition, Language, OperatorSetDefinition } from "../parser/index.js";

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

  it("converts named language objects into parser configs without aliasing source definitions", () => {
    const operatorSet: OperatorSetDefinition = {
      name: "math_ops",
      prefixOperators: {
        "-": { precedence: 9 }
      },
      infixOperators: {
        "+": { precedence: 7 }
      }
    };

    const commandSet: CommandSetDefinition = {
      name: "math_cmds",
      commands: {
        calc: {
          arguments: [{ name: "expr", kind: "expression", positional: true }]
        }
      },
      strictCommands: true,
      defaultCommand: {
        argumentKind: "raw",
        parseNamedArguments: false
      }
    };

    const language: Language = createLanguage({
      commandSet,
      operatorSet
    }, {
      allowAssignmentStatements: true
    });

    const expressionConfig = toExpressionParserConfig(operatorSet);
    const commandConfig = toCommandParserDefinition(commandSet);
    const parserConfig = toParserConfig(language);

    expect(expressionConfig).toEqual({
      prefixOperators: operatorSet.prefixOperators,
      infixOperators: operatorSet.infixOperators
    });
    expect(commandConfig).toMatchObject({
      commands: commandSet.commands,
      strictCommands: true,
      defaultCommand: commandSet.defaultCommand
    });
    expect(parserConfig).toMatchObject({
      prefixOperators: operatorSet.prefixOperators,
      infixOperators: operatorSet.infixOperators,
      commands: commandSet.commands,
      strictCommands: true,
      defaultCommand: commandSet.defaultCommand,
      allowAssignmentStatements: true
    });
    expressionConfig.prefixOperators["+"] = { precedence: 5 };
    commandConfig.commands.calc!.arguments![0]!.name = "changed";
    parserConfig.commands!.calc!.arguments![0]!.name = "mutated";

    expect(operatorSet.prefixOperators["+"]).toBeUndefined();
    expect(commandSet.commands.calc?.arguments?.[0]?.name).toBe("expr");
    expect(language.commandSet.commands.calc?.arguments?.[0]?.name).toBe("expr");
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
              nestedScope: createLanguage({
                commandSet: {
                  name: "only_cmds",
                  commands: {
                    only: { arguments: [] }
                  },
                  strictCommands: true
                },
                operatorSet: {
                  name: "only_ops",
                  prefixOperators: {},
                  infixOperators: {}
                }
              })
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

describe("parseInvocation", () => {
  function declaration(source: string) {
    const tokens = scan(source);
    const cmdIndex = tokens.findIndex((token) => token.type === "identifier" && token.value === "cmd");
    if (cmdIndex < 0) {
      throw new Error("expected cmd declaration in test input");
    }
    return parseCommandDeclaration(tokens.slice(cmdIndex + 1));
  }

  function invocation(source: string) {
    return scan(source);
  }

  it("parses simple positional invocation", () => {
    const decl = declaration("cmd echo _ ... { }");
    const parsed = parseInvocation(invocation("echo hello world"), decl);

    expect(parsed.commandName).toBe("echo");
    expect(parsed.arguments.varArgs).toEqual(["hello", "world"]);
  });

  it("parses named positional invocation", () => {
    const decl = declaration("cmd greet name { }");
    const parsed = parseInvocation(invocation("greet Alice"), decl);

    expect(parsed.arguments.namedArgs).toEqual({ name: "Alice" });
    expect(parsed.arguments.varArgs).toEqual([]);
  });

  it("parses keyed clause invocations", () => {
    const decl = declaration("cmd send _ (to _) { } ");
    const parsed = parseInvocation(invocation("send hello to admin"), decl);

    expect(parsed.arguments.varArgs).toEqual(["hello"]);
    expect(parsed.arguments.clauses.to).toHaveLength(1);
    expect(parsed.arguments.clauses.to?.[0]?.varArgs).toEqual(["admin"]);
  });

  it("parses multiple keyed clause occurrences", () => {
    const decl = declaration("cmd add (item _)+ { } ");
    const parsed = parseInvocation(invocation("add item apple item banana"), decl);

    expect(parsed.arguments.clauses.item).toHaveLength(2);
    expect(parsed.arguments.clauses.item?.[0]?.varArgs).toEqual(["apple"]);
    expect(parsed.arguments.clauses.item?.[1]?.varArgs).toEqual(["banana"]);
  });

  it("applies greedy vararg with trailing required named args", () => {
    const decl = declaration("cmd cp _ ... destination { } ");
    const parsed = parseInvocation(invocation("cp a b c dst"), decl);

    expect(parsed.arguments.varArgs).toEqual(["a", "b", "c"]);
    expect(parsed.arguments.namedArgs).toEqual({ destination: "dst" });
  });

  it("parses qualifiers as booleans", () => {
    const decl = declaration("cmd verbose? cp _ ... { } ");

    const withQualifier = parseInvocation(invocation("verbose cp a b"), decl);
    expect(withQualifier.qualifiers).toEqual({ verbose: true });

    const withoutQualifier = parseInvocation(invocation("cp a b"), decl);
    expect(withoutQualifier.qualifiers).toEqual({ verbose: false });
  });

  it("treats quoted keyword tokens as values", () => {
    const decl = declaration("cmd send _ (to _) { } ");
    const parsed = parseInvocation(invocation("send \"to\" to admin"), decl);

    expect(parsed.arguments.varArgs).toEqual(['"to"']);
    expect(parsed.arguments.clauses.to?.[0]?.varArgs).toEqual(["admin"]);
  });

  it("throws for missing required args", () => {
    const decl = declaration("cmd greet name { } ");
    expect(() => parseInvocation(invocation("greet"), decl)).toThrowError("Missing required positional argument 'name'");
  });

  it("throws for keyword not valid in current context", () => {
    const decl = declaration("cmd send _ (to (as _)) { } ");
    expect(() => parseInvocation(invocation("send hello as role to admin"), decl)).toThrowError("Keyword 'as' is not valid in this context");
  });

  it("throws for too many positional arguments", () => {
    const decl = declaration("cmd greet name { } ");
    expect(() => parseInvocation(invocation("greet Alice Bob"), decl)).toThrowError("Too many positional arguments");
  });
});

describe("validateInvocation", () => {
  function declaration(source: string) {
    const tokens = scan(source);
    const cmdIndex = tokens.findIndex((token) => token.type === "identifier" && token.value === "cmd");
    if (cmdIndex < 0) {
      throw new Error("expected cmd declaration in test input");
    }
    return parseCommandDeclaration(tokens.slice(cmdIndex + 1));
  }

  function invocation(source: string) {
    return scan(source);
  }

  it("accepts valid invocations", () => {
    const decl = declaration("cmd send _ (to _)+ [cc _]* { } ");
    const parsed = parseInvocation(invocation("send hello to admin cc team to backup"), decl);
    expect(() => validateInvocation(parsed, decl)).not.toThrow();
  });

  it("rejects missing required keyed clause", () => {
    const decl = declaration("cmd send _ (to _) { } ");
    const parsed = parseInvocation(invocation("send hello"), decl);
    expect(() => validateInvocation(parsed, decl)).toThrowError("Missing required clause 'to'");
  });

  it("rejects repeated single-use clauses", () => {
    const decl = declaration("cmd send _ [cc _] { } ");
    const parsed = parseInvocation(invocation("send hello cc one cc two"), decl);
    expect(() => validateInvocation(parsed, decl)).toThrowError("Clause 'cc' may appear at most once");
  });

  it("rejects command/declaration mismatch", () => {
    const sendDecl = declaration("cmd send _ { } ");
    const cpDecl = declaration("cmd cp _ { } ");
    const parsed = parseInvocation(invocation("send hello"), sendDecl);
    expect(() => validateInvocation(parsed, cpDecl)).toThrowError("Expected command 'cp' but found 'send'");
  });

  it("rejects nested required clause omissions", () => {
    const decl = declaration("cmd send _ (to _ (as _)) { } ");
    const parsed = parseInvocation(invocation("send hello to admin"), decl);
    expect(() => validateInvocation(parsed, decl)).toThrowError("Missing required clause 'as'");
  });
});
