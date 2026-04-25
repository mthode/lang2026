import { describe, expect, it } from "vitest";
import { createLanguage } from "../parser/index.js";
import { createShellEnvironment, executeShellCommand, executeShellSource, parseShellLine } from "../shell/index.js";
import {
  SHELL_LANGUAGE_NAME,
  SHELL_OPERATOR_SET_NAME,
  SHELL_STATEMENT_SET_NAME,
  registerLanguage,
  registerOperatorSet,
  registerStatementSet,
  shellLanguage,
  shellStatementSet
} from "../shell/custom-language.js";

describe("shell eval command", () => {
  it("seeds default language registries in the shell environment", () => {
    const environment = createShellEnvironment();

    const operatorSet = environment.operatorSets.get(SHELL_OPERATOR_SET_NAME);
    const statementSet = environment.statementSets.get(SHELL_STATEMENT_SET_NAME);
    const language = environment.languages.get(SHELL_LANGUAGE_NAME);

    expect(operatorSet).toBeDefined();
    expect(statementSet).toBeDefined();
    expect(language).toBeDefined();
    expect(statementSet?.statements.echo).toBeDefined();
    expect(language).toMatchObject({
      allowAssignmentStatements: true
    });
    expect(language?.statementSet.statements.echo).toBeDefined();
    expect(language?.operatorSet.infixOperators["+"]).toBeDefined();
  });

  it("rejects duplicate language object registration", () => {
    const environment = createShellEnvironment();

    expect(() =>
      registerOperatorSet(environment.operatorSets, SHELL_OPERATOR_SET_NAME, {
        prefixOperators: {},
        infixOperators: {}
      })
    ).toThrowError(`Cannot redefine operator set '${SHELL_OPERATOR_SET_NAME}'`);

    expect(() =>
      registerStatementSet(environment.statementSets, SHELL_STATEMENT_SET_NAME, {
        statements: {}
      })
    ).toThrowError(`Cannot redefine statement set '${SHELL_STATEMENT_SET_NAME}'`);

    expect(() =>
      registerLanguage(environment.languages, SHELL_LANGUAGE_NAME, shellLanguage)
    ).toThrowError(`Cannot redefine language '${SHELL_LANGUAGE_NAME}'`);
  });

  it("declares operator sets, statement sets, and languages", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
        parseShellLine("operators math_ops { prefix ! precedence 9 infix %% precedence 7 left }"),
      environment
    );
    executeShellCommand(
        parseShellLine("statements calc_statements { echo eval }"),
      environment
    );
    executeShellCommand(
        parseShellLine("language calc_lang statements calc_statements operators math_ops"),
      environment
    );

    expect(environment.operatorSets.get("math_ops")).toMatchObject({
      prefixOperators: {
        "!": { precedence: 9 }
      },
      infixOperators: {
        "%%": { precedence: 7, associativity: "left" }
      }
    });
    expect(environment.statementSets.get("calc_statements")).toMatchObject({
      strictStatements: true
    });
    expect(environment.statementSets.get("calc_statements")?.statements.echo).toBeDefined();
    expect(environment.statementSets.get("calc_statements")?.statements.eval).toBeDefined();
    expect(environment.languages.get("calc_lang")).toMatchObject({
      statementSet: {
        strictStatements: true
      },
      operatorSet: {
        prefixOperators: {
          "!": { precedence: 9 }
        }
      }
    });
  });

  it("rejects duplicate operators, statements, and language declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("operators shell_ops { prefix ! precedence 9 }"),
        environment
      )
    ).toThrowError(`Cannot redefine operator set '${SHELL_OPERATOR_SET_NAME}'`);

    expect(() =>
      executeShellCommand(
        parseShellLine("statements shell_statements { echo }"),
      environment
    )
    ).toThrowError(`Cannot redefine statement set '${SHELL_STATEMENT_SET_NAME}'`);

    expect(() =>
      executeShellCommand(
        parseShellLine("language shell statements shell_statements operators shell_ops"),
        environment
      )
    ).toThrowError(`Cannot redefine language '${SHELL_LANGUAGE_NAME}'`);
  });

  it("rejects unknown statement references in statement set declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("statements broken_statements { echo missing_statement }"),
        environment
      )
    ).toThrowError("Unknown statement 'missing_statement'");
  });

  it("rejects unsupported statement set body constructs explicitly", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("statements composed_statements { import echo }"),
        environment
      )
    ).toThrowError("Unsupported statement set construct 'import'");

    expect(() =>
      executeShellCommand(
        parseShellLine("statements dup_statements { echo echo }"),
        environment
      )
    ).toThrowError("Duplicate statement 'echo' in statement set body");
  });

  it("rejects unsupported operator set body constructs explicitly", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("operators bad_ops { postfix ! precedence 9 }"),
        environment
      )
    ).toThrowError("Unsupported operator definition kind 'postfix'");

    expect(() =>
      executeShellCommand(
        parseShellLine("operators bad_ops { infix + precedence 7 center }"),
        environment
      )
    ).toThrowError("Unsupported infix associativity 'center'");
  });

  it("rejects unknown named set references in language declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("language broken_lang statements missing_statements operators shell_ops"),
        environment
      )
    ).toThrowError("Unknown statement set 'missing_statements'");

    expect(() =>
      executeShellCommand(
        parseShellLine("language broken_lang statements shell_statements operators missing_ops"),
        environment
      )
    ).toThrowError("Unknown operator set 'missing_ops'");
  });

  it("parses eval expression with spaces as a single argument", () => {
    const statement = parseShellLine("eval 1 + 2 * 3");
    expect(statement.kind).toBe("statement");
    if (statement.kind !== "statement") throw new Error("expected statement");
    expect(statement.name).toBe("eval");
    expect(Object.keys(statement.args)).toEqual(["expression"]);
  });

  it("evaluates basic arithmetic", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("eval 1 + 2 * 3 - 4 / 2");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("5");
  });

  it("stores assignment values in environment", () => {
    const environment = createShellEnvironment();
    const assign = parseShellLine("x = 10");
    const evalStatement = parseShellLine("eval x * 2");

    executeShellCommand(assign, environment);
    const output = executeShellCommand(evalStatement, environment);

    expect(output).toBe("20");
    expect(environment.variables.x).toBe(10);
  });

  it("supports parentheses to control order of operations", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("eval (2 + 2) * 3");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("12");
  });

  it("supports nested parentheses in expressions", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("eval ((1 + 2) * (3 + 1)) / 2");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("6");
  });

  it("echo prints arguments", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("echo hello 123 world");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("hello 123 world");
  });

  it("echo treats operator-looking arguments as raw text", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("echo 1 + 2");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("1 + 2");
  });

  it("if executes then block when condition is true", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("if 1 then { echo yes } else { echo no }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("yes");
  });

  it("if executes else block when condition is false", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("if 0 then { echo yes } else { echo no }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("no");
  });

  it("if supports nested commands", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("if 1 then { if 0 then { echo a } else { echo b } } else { echo c }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("b");
  });

  it("if supports missing else when condition is true", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("if 1 then { echo yes }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("yes");
  });

  it("if supports missing else when condition is false", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("if 0 then { echo yes }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBeUndefined();
  });

  it("if argument schema is validated by parser", () => {
    expect(() => parseShellLine("if 1")).toThrowError("Missing required named argument 'then'");
  });

  it("if rejects extra arguments", () => {
    expect(() => parseShellLine("if 1 then { echo yes } else { echo no } trailing")).toThrowError("Unexpected extra arguments");
  });

  it("if rejects missing condition with clear parser error", () => {
    expect(() => parseShellLine("if then { echo yes }")).toThrowError("Invalid value for argument 'condition': Expected expression");
  });

  it("if rejects non-block then value with clear parser error", () => {
    expect(() => parseShellLine("if 1 then nope")).toThrowError("Invalid value for argument 'then': Expected nested block starting with '{'");
  });

  it("if rejects non-block else value with clear parser error", () => {
    expect(() => parseShellLine("if 1 then { echo yes } else nope")).toThrowError("Invalid value for argument 'else': Expected nested block starting with '{'");
  });

  it("defines and invokes user commands", () => {
    const environment = createShellEnvironment();
    const define = parseShellLine("cmd add a b { eval $a + $b }");
    const defineOutput = executeShellCommand(define, environment);
    expect(defineOutput).toBeUndefined();

    const call = parseShellLine("add 2 3");
    const callOutput = executeShellCommand(call, environment);
    expect(callOutput).toBe("5");
  });

  it("registers parser-level statements with stmt without creating commands", () => {
    const environment = createShellEnvironment();

    const defineOutput = executeShellCommand(parseShellLine("stmt declare name"), environment);

    expect(defineOutput).toBeUndefined();
    expect(environment.statementDeclarations.get("declare")).toMatchObject({
      name: "declare",
      argDecls: {
        positional: [{ kind: "named", name: "name", optional: false }],
        keyedClauses: []
      },
      blocks: []
    });
    expect(environment.commands.has("declare")).toBe(false);
  });

  it("keeps stmt declarations declarative, including block metadata and unresolved names", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("stmt --evaluate missing_ops choose condition (then {} :: then_lang) [else {}]"),
      environment
    );

    expect(environment.statementDeclarations.get("choose")).toMatchObject({
      name: "choose",
      argumentOperatorSetName: "missing_ops",
      blocks: [],
      argDecls: {
        positional: [{ kind: "named", name: "condition", optional: false }],
        keyedClauses: [
          {
            keyword: "then",
            required: true,
            allowMultiple: false,
            block: { languageName: "then_lang" }
          },
          {
            keyword: "else",
            required: false,
            allowMultiple: false,
            block: {}
          }
        ]
      }
    });
    expect(environment.commands.has("choose")).toBe(false);
  });

  it("rejects content-bearing trailing blocks in stmt declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(parseShellLine("stmt render target { echo nope }"), environment)
    ).toThrowError("Statement 'render' block 'body' must be declared with an empty shape-only body");
  });

  it("rejects blockless command declarations at shell narrowing time", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(parseShellLine("cmd declare name"), environment)
    ).toThrowError("Command 'declare' must declare exactly one implementation block");
  });

  it("rejects multi-block command declarations at shell narrowing time", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("cmd choose condition then { echo yes } else { echo no }"),
        environment
      )
    ).toThrowError("Command 'choose' must declare exactly one implementation block");
  });

  it("uses selected operator sets when invoking user commands", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("operators math_ops { infix + precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd --evaluate math_ops show value { eval $value }"),
      environment
    );

    const output = executeShellCommand(parseShellLine("show 1 + 2"), environment);
    expect(output).toBe("3");
  });

  it("executes command bodies in the selected language", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("statements eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("language eval_lang statements eval_only operators shell_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd calc value { eval $value } :: eval_lang"),
      environment
    );

    const output = executeShellCommand(parseShellLine("calc 3"), environment);
    expect(output).toBe("3");
  });

  it("rejects unsupported commands inside a custom command body language", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("statements eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("language eval_lang statements eval_only operators shell_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd broken { echo nope } :: eval_lang"),
      environment
    );

    expect(() => executeShellCommand(parseShellLine("broken"), environment)).toThrowError("Unknown statement 'echo'");
  });

  it("inherits the selected language into nested blocks inside command bodies", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("statements if_eval_only { if eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("language if_eval_lang statements if_eval_only operators shell_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd nested { if 1 then { echo nope } } :: if_eval_lang"),
      environment
    );

    expect(() => executeShellCommand(parseShellLine("nested"), environment)).toThrowError("Unknown statement 'echo'");
  });

  it("resolves named operator sets and languages when defining commands", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("operators math_ops { infix %% precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("statements eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("language eval_lang statements eval_only operators math_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd --evaluate math_ops calc { eval 1 %% 2 } :: eval_lang"),
      environment
    );

    const definition = environment.commands.get("calc");
    expect(definition?.argumentOperatorSet).toMatchObject({
      infixOperators: {
        "%%": { precedence: 7, associativity: "left" }
      }
    });
    expect(definition?.bodyLanguage).toMatchObject({
      statementSet: {
        strictStatements: true
      }
    });
    expect(definition?.bodyLanguage?.statementSet.statements.eval).toBeDefined();
  });

  it("rejects unknown named set references when defining commands", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("cmd --evaluate missing_ops broken { echo hi }"),
        environment
      )
    ).toThrowError("Unknown operator set 'missing_ops'");

    expect(() =>
      executeShellCommand(
        parseShellLine("cmd broken { echo hi } :: missing_lang"),
        environment
      )
    ).toThrowError("Unknown language 'missing_lang'");
  });

  it("captures resolved body language at command declaration time", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("operators math_ops { infix %% precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("statements eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("language eval_lang statements eval_only operators math_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd --evaluate math_ops calc { eval 1 %% 2 } :: eval_lang"),
      environment
    );

    const definition = environment.commands.get("calc");
    expect(definition?.argumentOperatorSet?.infixOperators["%%"]).toMatchObject({
      precedence: 7,
      associativity: "left"
    });
    expect(definition?.bodyLanguage?.statementSet.statements.eval).toBeDefined();

    const shellStatements = environment.statementSets.get(SHELL_STATEMENT_SET_NAME);
    const shellOperators = environment.operatorSets.get(SHELL_OPERATOR_SET_NAME);
    if (!shellStatements || !shellOperators) {
      throw new Error("expected seeded shell language registries");
    }

    environment.languages.set(
      "eval_lang",
      createLanguage({
        statementSet: {
          statements: {
            echo: shellStatements.statements.echo!
          },
          strictStatements: true
        },
        operatorSet: shellOperators
      })
    );
    environment.operatorSets.set("math_ops", {
      prefixOperators: {},
      infixOperators: {
        "@@": { precedence: 3, associativity: "right" }
      }
    });

    expect(definition?.argumentOperatorSet?.infixOperators["%%"]).toMatchObject({
      precedence: 7,
      associativity: "left"
    });
    expect(definition?.argumentOperatorSet?.infixOperators["@@"]).toBeUndefined();
    expect(definition?.bodyLanguage?.statementSet.statements.eval).toBeDefined();
    expect(definition?.bodyLanguage?.statementSet.statements.echo).toBeUndefined();
  });

  it("supports numeric positional placeholders in user commands", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd addp a b { eval $1 + $2 }"), environment);

    const call = parseShellLine("addp 2 3");
    const callOutput = executeShellCommand(call, environment);

    expect(callOutput).toBe("5");
  });

  it("supports optional positional function arguments", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd show a b? { echo $a }"), environment);
    const call = parseShellLine("show 10");
    const callOutput = executeShellCommand(call, environment);
    expect(callOutput).toBe("10");
  });

  it("supports named function args and flags", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd cfg x y z [flag _]* { echo $flag $x $y $z }"), environment);
    const call = parseShellLine("cfg 7 8 9 flag true");
    const callOutput = executeShellCommand(call, environment);
    expect(callOutput).toBe("true 7 8 9");
  });

  it("validates named argument arity in function calls", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd cfg2 (x _ _) { echo $x }"), environment);
    expect(() => executeShellCommand(parseShellLine("cfg2 x 1"), environment)).toThrowError("Missing required positional argument '_'");
  });

  it("while loops while condition is non-zero", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("while 3 - loop do { echo $loop }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("0\n1\n2");
  });

  it("substitutes variables per statement within loop bodies", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("x = 0"), environment);

    const statement = parseShellLine("while 3 - x do { x = x + 1\necho $x }");
    const output = executeShellCommand(statement, environment);

    expect(output).toBe("1\n2\n3");
  });

  it("for loops with default step", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("for i from 1 to 3 do { echo $i }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("1\n2\n3");
  });

  it("for loops with explicit step", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("for i from 1 to 5 step 2 do { echo $i }");
    const output = executeShellCommand(statement, environment);
    expect(output).toBe("1\n3\n5");
  });

  it("for rejects non-identifier iterator", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("for 1 from 1 to 3 do { echo 1 }");
    expect(() => executeShellCommand(statement, environment)).toThrowError("iterator must be an identifier");
  });

  it("keeps global variables accessible outside command bodies", () => {
    const environment = createShellEnvironment();

    executeShellCommand(parseShellLine("i = 42"), environment);
    executeShellCommand(parseShellLine("for i from 1 to 2 do { echo $i }"), environment);

    const output = executeShellCommand(parseShellLine("eval i"), environment);
    expect(output).toBe("42");
  });

  it("supports top-level variable substitution during shell source execution", () => {
    const environment = createShellEnvironment();

    const result = executeShellSource("x = 5\necho $x", environment);

    expect(result.output).toBe("5");
  });

  it("rejects unknown set names in end-to-end shell source execution", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellSource(
        "cmd --evaluate missing_ops broken value { eval $value }",
        environment
      )
    ).toThrowError("Unknown operator set 'missing_ops'");
  });

  it("rejects invalid body annotations in end-to-end shell source execution", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellSource(
        "cmd broken { echo hi } ::",
        environment
      )
    ).toThrowError("Expected language name after '::'");
  });

  it("rejects disallowed statements inside custom languages in end-to-end shell source execution", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellSource(
        [
          "statements eval_only { eval }",
          "language eval_lang statements eval_only operators shell_ops",
          "cmd broken { echo nope } :: eval_lang",
          "broken"
        ].join("\n"),
        environment
      )
    ).toThrowError("Unknown statement 'echo'");
  });

  it("routes unknown commands to OS executor with raw arguments", () => {
    const environment = createShellEnvironment({
      executeOsCommand: (command, args) => `${command}:${args.join("|")}`
    });

    const statement = parseShellLine("external 1 + 2 \"hello world\"");
    const output = executeShellCommand(statement, environment);

    expect(output).toBe("external:1|+|2|hello world");
  });

  it("returns web-specific error when OS commands are unavailable", () => {
    const environment = createShellEnvironment();
    const statement = parseShellLine("external-test anything");

    expect(() => executeShellCommand(statement, environment)).toThrowError("OS commands are not available on the web");
  });

  it("cd updates current directory using environment resolver", () => {
    const environment = createShellEnvironment({
      currentDirectory: "/tmp",
      changeDirectory: (path, current) => `${current}/${path}`.replace(/\/+/g, "/")
    });

    const statement = parseShellLine("cd projects");
    const output = executeShellCommand(statement, environment);

    expect(output).toBeUndefined();
    expect(environment.currentDirectory).toBe("/tmp/projects");
  });

  it("cd validates required path argument", () => {
    expect(() => parseShellLine("cd")).toThrowError("Missing required argument 'path'");
  });
});
