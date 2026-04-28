import { describe, expect, it } from "vitest";
import {
  AssignmentStatementNode,
  BinaryExpressionNode,
  Language,
  NamedStatementNode,
  NestedBlockNode,
  OperatorSetDefinition,
  StatementSetDefinition,
  createParser
} from "../parser/index.js";
import { parseShellLine, parseShellScript } from "../shell/index.js";
import { ParsedStatement, StatementDeclaration, parseStatementDeclaration } from "../shell/declaration.js";
import { Token, scan } from "../scanner/index.js";
import { validateDeclaration } from "../shell/declaration.js";
import { parseInvocation, validateInvocation } from "../shell/invocation.js";
import { createLanguage, toExpressionParserConfig, toParserConfig, toStatementParserDefinition } from "../parser/language.js";
import { ShellEnvironment, UserCommandDefinition } from "../shell/commands/types.js";

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
    defaultStatement: {
      argumentKind: "expression",
      parseNamedArguments: true
    }
  });

  it("parses command name and arguments", () => {
    const command = parser.parseLine("echo hello");
    expect(command.kind).toBe("statement");
    expect(command).toBeInstanceOf(NamedStatementNode);
    if (command.kind !== "statement") throw new Error("expected statement");
    expect(command.name).toBe("echo");
    expect(Object.keys(command.args)).toHaveLength(1);
    expect(command.args.arg0 && typeof command.args.arg0 === "object" && "kind" in command.args.arg0 ? command.args.arg0.kind : "").toBe("identifier");
  });

  it("parses assignment statements", () => {
    const statement = parser.parseLine("set = 1 + 2");
    expect(statement.kind).toBe("assignment");
    expect(statement).toBeInstanceOf(AssignmentStatementNode);
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

  it("parses block parts into statement blocks", () => {
    const blockParser = createParser({
      prefixOperators: {},
      infixOperators: {},
      statements: {
        block: {
          parts: [{ kind: "block", name: "arg0", positional: true }]
        }
      }
    });

    const statement = blockParser.parseLine("block { echo hello }");
    expect(statement.kind).toBe("statement");
    if (statement.kind !== "statement") throw new Error("expected statement");

    const value = statement.blocks.arg0;
    expect(typeof value).not.toBe("string");
    expect(Array.isArray(value)).toBe(false);
    expect(value && typeof value === "object" && "kind" in value ? value.kind : "").toBe("nested-block");
    expect(value).toBeInstanceOf(NestedBlockNode);

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
      statements: {
        echo: {
          parts: [{ kind: "argument", name: "extras", valueKind: "expression", positional: true, vararg: true }]
        }
      }
    });

    const statement = varargParser.parseLine("echo one 2 3+4");
    expect(statement.kind).toBe("statement");
    if (statement.kind !== "statement") throw new Error("expected statement");

    const extras = statement.args.extras;
    expect(Array.isArray(extras)).toBe(true);
    expect((extras as unknown[]).length).toBe(3);
  });

  it("converts named language objects into parser configs with live statement definitions", () => {
    const operatorSet: OperatorSetDefinition = {
      name: "math_ops",
      prefixOperators: {
        "-": { precedence: 9 }
      },
      infixOperators: {
        "+": { precedence: 7 }
      }
    };

    const statementSet: StatementSetDefinition = {
      name: "math_statements",
      statements: {
        calc: {
          parts: [{ kind: "argument", name: "expr", valueKind: "expression", positional: true }]
        }
      },
      strictStatements: true,
      defaultStatement: {
        argumentKind: "raw",
        parseNamedArguments: false
      }
    };

    const language: Language = createLanguage({
      statementSet,
      operatorSet
    }, {
      allowAssignmentStatements: true
    });

    const expressionConfig = toExpressionParserConfig(operatorSet);
    const statementConfig = toStatementParserDefinition(statementSet);
    const parserConfig = toParserConfig(language);

    expect(expressionConfig).toEqual({
      prefixOperators: operatorSet.prefixOperators,
      infixOperators: operatorSet.infixOperators
    });
    expect(statementConfig).toMatchObject({
      statements: statementSet.statements,
      strictStatements: true,
      defaultStatement: statementSet.defaultStatement
    });
    expect(parserConfig).toMatchObject({
      prefixOperators: operatorSet.prefixOperators,
      infixOperators: operatorSet.infixOperators,
      statements: statementSet.statements,
      strictStatements: true,
      defaultStatement: statementSet.defaultStatement,
      allowAssignmentStatements: true
    });
    expressionConfig.prefixOperators["+"] = { precedence: 5 };
    statementConfig.statements!.calc!.parts![0]!.name = "changed";
    parserConfig.statements!.calc!.parts![0]!.name = "mutated";

    expect(operatorSet.prefixOperators["+"]).toBeUndefined();
    expect(statementSet.statements.calc?.parts?.[0]?.name).toBe("mutated");
    expect(language.statementSet.statements.calc?.parts?.[0]?.name).toBe("mutated");
    expect(language).toBeInstanceOf(Language);
    expect(new OperatorSetDefinition(operatorSet)).toBeInstanceOf(OperatorSetDefinition);
    expect(new StatementSetDefinition(statementSet)).toBeInstanceOf(StatementSetDefinition);
  });

  it("constructs scanner, expression, shell declaration, and environment values as classes", () => {
    const [token] = scan("eval 1 + 2");
    expect(token).toBeInstanceOf(Token);

    const parsed = parser.parseLine("set = 1 + 2");
    expect(parsed.kind).toBe("assignment");
    if (parsed.kind !== "assignment") throw new Error("expected assignment");
    expect(parsed.value).toBeInstanceOf(BinaryExpressionNode);

    const declarationTokens = scan("cmd noop { echo hi }").slice(1);
    const declaration = parseStatementDeclaration(declarationTokens);
    expect(declaration).toBeInstanceOf(StatementDeclaration);

    const invocation = parseInvocation(scan("noop"), declaration);
    expect(invocation).toBeInstanceOf(ParsedStatement);

    const environment = new ShellEnvironment();
    expect(environment).toBeInstanceOf(ShellEnvironment);
    expect(new UserCommandDefinition(declaration, "echo hi")).toBeInstanceOf(UserCommandDefinition);
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
      statements: {
        calc: {
          parts: [
            {
              kind: "argument",
              name: "expr",
              valueKind: "expression",
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
          parts: [{ kind: "argument", name: "expr", valueKind: "expression", positional: true }]
        }
      },
      strictStatements: true
    });

    const calc = overrideParser.parseLine("calc 1 + 2 * 3");
    expect(calc.kind).toBe("statement");
    if (calc.kind !== "statement") throw new Error("expected statement");

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

  it("keeps default nested blocks scope-free", () => {
    const nestedParser = createParser({
      prefixOperators: {},
      infixOperators: {},
      statements: {
        outer: {
          parts: [{ kind: "block", name: "body", positional: true }]
        },
        inner: {
          parts: []
        }
      },
      strictStatements: true
    });

    const outer = nestedParser.parseLine("outer { inner }");
    expect(outer.kind).toBe("statement");
    if (outer.kind !== "statement") throw new Error("expected statement");

    const body = outer.blocks.body;
    expect(body && typeof body === "object" && !Array.isArray(body) && "kind" in body ? body.kind : "").toBe("nested-block");

    if (!body || typeof body !== "object" || Array.isArray(body) || !("kind" in body) || body.kind !== "nested-block") {
      throw new Error("expected nested block");
    }

    const nested = nestedParser.parseLine(body.content);
    expect(nested.kind).toBe("statement");
    if (nested.kind !== "statement") throw new Error("expected statement");
    expect(nested.name).toBe("inner");
  });
});

describe("parseStatementDeclaration", () => {
  function declarationTokens(source: string) {
    const tokens = scan(source);
    const cmdIndex = tokens.findIndex((token) => token.type === "identifier" && token.value === "cmd");
    if (cmdIndex < 0) {
      throw new Error("expected cmd declaration in test input");
    }
    return tokens.slice(cmdIndex + 1);
  }

  it("parses command with no arguments", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd noop { echo hi }"));

    expect(decl.name).toBe("noop");
    expect(decl.qualifiers).toEqual([]);
    expect(decl.argumentOperatorSetName).toBeUndefined();
    expect(decl.argDecls).toEqual({ positional: [], keyedClauses: [], vararg: undefined });
    expect(decl.blocks).toEqual([
      { name: "body", required: true, allowMultiple: false }
    ]);
    expect([...decl.globalKeywords]).toEqual([]);
  });

  it("parses evaluate and body language annotations", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd --evaluate math_ops verbose? render name { echo hi } :: template_lang"));

    expect(decl.name).toBe("render");
    expect(decl.argumentOperatorSetName).toBe("math_ops");
    expect(decl.blocks).toEqual([
      { name: "body", required: true, allowMultiple: false, languageName: "template_lang" }
    ]);
    expect(decl.qualifiers).toEqual([{ keyword: "verbose" }]);
    expect(decl.argDecls.positional).toEqual([{ kind: "named", name: "name", optional: false }]);
  });

  it("parses multiple named statement blocks", () => {
    const decl = parseStatementDeclaration(
      declarationTokens("cmd choose condition then { echo yes } :: then_lang else { echo no }")
    );

    expect(decl.name).toBe("choose");
    expect(decl.argDecls.positional).toEqual([{ kind: "named", name: "condition", optional: false }]);
    expect(decl.blocks).toEqual([
      { name: "then", required: true, allowMultiple: false, languageName: "then_lang" },
      { name: "else", required: true, allowMultiple: false }
    ]);
  });

  it("allows blockless statement declarations", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd declare name"));

    expect(decl.name).toBe("declare");
    expect(decl.argDecls.positional).toEqual([{ kind: "named", name: "name", optional: false }]);
    expect(decl.blocks).toEqual([]);
  });

  it("parses positional args, optional args, keyed clauses, and vararg trailing names", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd verbose? cp _ src? (to _) [mode name]* ... destination { echo hi }"));

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
    const decl = parseStatementDeclaration(declarationTokens("cmd move (from _ (within _)) (to _) { echo hi }"));

    expect(decl.argDecls.keyedClauses).toHaveLength(2);
    const fromClause = decl.argDecls.keyedClauses[0];
    expect(fromClause?.keyword).toBe("from");
    expect(fromClause?.argDecls.keyedClauses).toHaveLength(1);
    expect(fromClause?.argDecls.keyedClauses[0]?.keyword).toBe("within");
    expect([...decl.globalKeywords]).toEqual(["from", "within", "to"]);
  });

  it("parses invocation-time block markers on keyed clauses", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd if condition (then {}) [else {}]"));

    expect(decl.blocks).toEqual([]);
    expect(decl.argDecls.keyedClauses[0]).toMatchObject({
      keyword: "then",
      required: true,
      allowMultiple: false,
      argDecls: {
        positional: [],
        keyedClauses: []
      }
    });
    expect(decl.argDecls.keyedClauses[0]?.block).toEqual({});
    expect(decl.argDecls.keyedClauses[1]).toMatchObject({
      keyword: "else",
      required: false,
      allowMultiple: false,
      argDecls: {
        positional: [],
        keyedClauses: []
      }
    });
    expect(decl.argDecls.keyedClauses[1]?.block).toEqual({});
  });

  it("parses language annotations on invocation-time block markers", () => {
    const decl = parseStatementDeclaration(
      declarationTokens("cmd if condition (then {} :: then_lang) [else {} :: else_lang]")
    );

    expect(decl.argDecls.keyedClauses[0]?.block).toEqual({ languageName: "then_lang" });
    expect(decl.argDecls.keyedClauses[1]?.block).toEqual({ languageName: "else_lang" });
  });

  it("throws for duplicate keyed clause keywords", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken (to _) [to _] { echo hi }"))
    ).toThrowError("Duplicate keyed clause keyword 'to'");
  });

  it("throws for invalid quantifier placement", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken (to _)* { echo hi }"))
    ).toThrowError("Invalid quantifier '*'");

    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken [to _]+ { echo hi }"))
    ).toThrowError("Invalid quantifier '+'");
  });

  it("throws when a block marker is not the final item in a keyed clause", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken (then {} label)"))
    ).toThrowError("Block marker '{}' must be the last item in a keyed clause declaration");
  });

  it("throws when there is content after the body", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken { echo hi } trailing"))
    ).toThrowError("Unexpected content after statement block");
  });

  it("throws for repeated evaluate annotations", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd --evaluate shell_ops --evaluate math_ops broken { echo hi }"))
    ).toThrowError("Repeated '--evaluate' annotation");
  });

  it("throws for missing or repeated body annotations", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken { echo hi } ::"))
    ).toThrowError("Expected language name after '::'");

    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken { echo hi } :: one :: two"))
    ).toThrowError("Repeated block annotation ':: Name'");
  });

  it("throws for missing or repeated keyed block annotations", () => {
    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken (then {} ::)"))
    ).toThrowError("Expected language name after '::'");

    expect(() =>
      parseStatementDeclaration(declarationTokens("cmd broken (then {} :: one :: two)"))
    ).toThrowError("Repeated block annotation ':: Name'");
  });

  it("validateDeclaration rejects duplicate statement block names", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd broken then { echo hi } then { echo bye }"));
    expect(() => validateDeclaration(decl, new Set())).toThrowError("Duplicate statement block 'then'");
  });

  it("validateDeclaration rejects invocation block names colliding with statement blocks", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd broken (then {}) then { echo hi }"));
    expect(() => validateDeclaration(decl, new Set())).toThrowError("Invocation block clause 'then' collides with statement block 'then'");
  });

  it("validateDeclaration rejects qualifier colliding with existing command name", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd verbose? cp { }"));
    expect(() => validateDeclaration(decl, new Set(["verbose"]))).toThrowError("Qualifier keyword 'verbose' collides with existing command name");
  });

  it("validateDeclaration rejects qualifier colliding with keyed clause keyword", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd verbose? cp (verbose _) { }"));
    expect(() => validateDeclaration(decl, new Set())).toThrowError("Qualifier keyword 'verbose' collides with a keyed clause keyword");
  });

  it("validateDeclaration rejects nested vararg when ancestor has trailing named args", () => {
    const decl = parseStatementDeclaration(declarationTokens("cmd bad _ (child (sub ...)) ... dest { echo }"));
    expect(() => validateDeclaration(decl, new Set())).toThrowError("Nested keyword clauses cannot contain '...' when a higher-level clause contains trailing required positional declarations");
  });
});

describe("parseInvocation", () => {
  const mathExpressionConfig = toExpressionParserConfig({
    prefixOperators: {
      "-": { precedence: 9 }
    },
    infixOperators: {
      "+": { precedence: 7 },
      "*": { precedence: 8 }
    }
  });

  function declaration(source: string) {
    const tokens = scan(source);
    const cmdIndex = tokens.findIndex((token) => token.type === "identifier" && token.value === "cmd");
    if (cmdIndex < 0) {
      throw new Error("expected cmd declaration in test input");
    }
    return parseStatementDeclaration(tokens.slice(cmdIndex + 1));
  }

  function invocation(source: string) {
    return scan(source);
  }

  it("parses simple positional invocation", () => {
    const decl = declaration("cmd echo _ ... { }");
    const parsed = parseInvocation(invocation("echo hello world"), decl);

    expect(parsed.statementName).toBe("echo");
    expect(parsed.arguments.varArgs).toEqual(["hello", "world"]);
    expect(parsed.blocks).toEqual({});
  });

  it("does not project declaration-time blocks into parsed invocations", () => {
    const decl = declaration("cmd choose condition then { echo yes } else { echo no }");
    const parsed = parseInvocation(invocation("choose 1"), decl);

    expect(parsed.blocks).toEqual({});
  });

  it("keeps parsed invocation blocks empty for blockless declarations", () => {
    const decl = declaration("cmd declare name");
    const parsed = parseInvocation(invocation("declare value"), decl);

    expect(parsed.blocks).toEqual({});
  });

  it("binds keyed clause blocks from invocation source", () => {
    const decl = declaration("cmd if condition (then {}) [else {}]");
    const parsed = parseInvocation(invocation("if ready then { echo yes } else { echo no }"), decl);

    expect(parsed.arguments.namedArgs.condition).toBe("ready");
    expect(parsed.arguments.clauses.then).toHaveLength(1);
    expect(parsed.arguments.clauses.else).toHaveLength(1);
    expect(parsed.blocks.then).toEqual([{ kind: "nested-block", content: "echo yes" }]);
    expect(parsed.blocks.else).toEqual([{ kind: "nested-block", content: "echo no" }]);
  });

  it("allows optional keyed block clauses to be absent", () => {
    const decl = declaration("cmd if condition (then {}) [else {}]");
    const parsed = parseInvocation(invocation("if ready then { echo yes }"), decl);

    expect(parsed.arguments.clauses.then).toHaveLength(1);
    expect(parsed.arguments.clauses.else).toBeUndefined();
    expect(parsed.blocks.then).toEqual([{ kind: "nested-block", content: "echo yes" }]);
    expect(parsed.blocks.else).toBeUndefined();
  });

  it("binds repeatable keyed block clauses", () => {
    const decl = declaration("cmd collect [part {}]*");
    const parsed = parseInvocation(invocation("collect part { echo one } part { echo two }"), decl);

    expect(parsed.arguments.clauses.part).toHaveLength(2);
    expect(parsed.blocks.part).toEqual([
      { kind: "nested-block", content: "echo one" },
      { kind: "nested-block", content: "echo two" }
    ]);
  });

  it("binds keyed block clauses that also declare arguments", () => {
    const decl = declaration("cmd match [case value {}]*");
    const parsed = parseInvocation(invocation("match case one { echo one } case two { echo two }"), decl);

    expect(parsed.arguments.clauses.case).toHaveLength(2);
    expect(parsed.arguments.clauses.case?.[0]?.namedArgs.value).toBe("one");
    expect(parsed.arguments.clauses.case?.[1]?.namedArgs.value).toBe("two");
    expect(parsed.blocks.case).toEqual([
      { kind: "nested-block", content: "echo one" },
      { kind: "nested-block", content: "echo two" }
    ]);
  });

  it("keeps keyed block payloads out of selected-operator expression arguments", () => {
    const decl = declaration("cmd --evaluate math_ops match [case value {}]*");
    const parsed = parseInvocation(invocation("match case 1 + 2 { echo one } case 3 + 4 { echo two }"), decl, {
      expressionConfig: mathExpressionConfig
    });

    const first = parsed.arguments.clauses.case?.[0]?.namedArgs.value;
    const second = parsed.arguments.clauses.case?.[1]?.namedArgs.value;
    expect(first && typeof first === "object" && !Array.isArray(first) && "kind" in first ? first.kind : "").toBe("binary");
    expect(second && typeof second === "object" && !Array.isArray(second) && "kind" in second ? second.kind : "").toBe("binary");
    expect(parsed.blocks.case).toEqual([
      { kind: "nested-block", content: "echo one" },
      { kind: "nested-block", content: "echo two" }
    ]);
  });

  it("throws when a present keyed block clause has no block", () => {
    const decl = declaration("cmd if condition (then {}) [else {}]");
    expect(() => parseInvocation(invocation("if ready then else { echo no }"), decl)).toThrowError("Expected nested block after clause 'then'");
  });

  it("parses expression-valued arguments with a selected operator set", () => {
    const decl = declaration("cmd --evaluate math_ops my_math value { }");
    const parsed = parseInvocation(invocation("my_math 2 + 2"), decl, { expressionConfig: mathExpressionConfig });

    const value = parsed.arguments.namedArgs.value;
    expect(value && typeof value === "object" && !Array.isArray(value) && "kind" in value ? value.kind : "").toBe("binary");
    if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value) || value.kind !== "binary") {
      throw new Error("expected binary expression value");
    }

    expect(value.operator).toBe("+");
  });

  it("splits multiple expression arguments while preserving longest complete expressions", () => {
    const decl = declaration("cmd --evaluate math_ops pair left right { }");
    const parsed = parseInvocation(invocation("pair 1 + 2 3 + 4"), decl, { expressionConfig: mathExpressionConfig });

    const left = parsed.arguments.namedArgs.left;
    const right = parsed.arguments.namedArgs.right;
    expect(left && typeof left === "object" && !Array.isArray(left) && "kind" in left ? left.kind : "").toBe("binary");
    expect(right && typeof right === "object" && !Array.isArray(right) && "kind" in right ? right.kind : "").toBe("binary");
  });

  it("keeps keyed clause keywords as expression boundaries", () => {
    const decl = declaration("cmd --evaluate math_ops send value (to target) { }");
    const parsed = parseInvocation(invocation("send 1 + 2 to admin"), decl, { expressionConfig: mathExpressionConfig });

    const value = parsed.arguments.namedArgs.value;
    expect(value && typeof value === "object" && !Array.isArray(value) && "kind" in value ? value.kind : "").toBe("binary");

    const target = parsed.arguments.clauses.to?.[0]?.namedArgs.target;
    expect(target && typeof target === "object" && !Array.isArray(target) && "kind" in target ? target.kind : "").toBe("identifier");
  });

  it("leaves enough input for trailing required arguments when parsing expressions", () => {
    const decl = declaration("cmd --evaluate math_ops cp left ... destination { }");
    const parsed = parseInvocation(invocation("cp 1 + 2 3 + 4 dst"), decl, { expressionConfig: mathExpressionConfig });

    const left = parsed.arguments.namedArgs.left;
    expect(left && typeof left === "object" && !Array.isArray(left) && "kind" in left ? left.kind : "").toBe("binary");
    expect(parsed.arguments.varArgs).toHaveLength(1);
    const vararg = parsed.arguments.varArgs[0];
    expect(vararg && typeof vararg === "object" && !Array.isArray(vararg) && "kind" in vararg ? vararg.kind : "").toBe("binary");
    const destination = parsed.arguments.namedArgs.destination;
    expect(destination && typeof destination === "object" && !Array.isArray(destination) && "kind" in destination ? destination.kind : "").toBe("identifier");
  });

  it("throws for incomplete selected-operator expressions", () => {
    const decl = declaration("cmd --evaluate math_ops my_math value { }");
    expect(() => parseInvocation(invocation("my_math 1 +"), decl, { expressionConfig: mathExpressionConfig })).toThrowError("Unexpected end of expression");
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
    return parseStatementDeclaration(tokens.slice(cmdIndex + 1));
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
    expect(() => validateInvocation(parsed, cpDecl)).toThrowError("Expected statement 'cp' but found 'send'");
  });

  it("rejects nested required clause omissions", () => {
    const decl = declaration("cmd send _ (to _ (as _)) { } ");
    const parsed = parseInvocation(invocation("send hello to admin"), decl);
    expect(() => validateInvocation(parsed, decl)).toThrowError("Missing required clause 'as'");
  });

  it("rejects repeated single-use block clauses", () => {
    const decl = declaration("cmd choose [case {}]");
    const parsed = parseInvocation(invocation("choose case { echo one } case { echo two }"), decl);
    expect(() => validateInvocation(parsed, decl)).toThrowError("Clause 'case' may appear at most once");
  });

  it("rejects parsed invocation block counts that do not match block clause occurrences", () => {
    const decl = declaration("cmd if condition (then {}) [else {}]");
    const parsed = parseInvocation(invocation("if ready then { echo yes }"), decl);
    const malformed = {
      ...parsed,
      blocks: {}
    };

    expect(() => validateInvocation(malformed, decl)).toThrowError("Block clause 'then' expected 1 block(s) but found 0");
  });

  it("rejects unexpected parsed block sections", () => {
    const decl = declaration("cmd declare name");
    const parsed = parseInvocation(invocation("declare value"), decl);
    const malformed = {
      ...parsed,
      blocks: {
        extra: [{ kind: "nested-block" as const, content: "echo no" }]
      }
    };

    expect(() => validateInvocation(malformed, decl)).toThrowError("Unexpected block section 'extra'");
  });
});
