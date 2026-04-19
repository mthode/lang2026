import { describe, expect, it } from "vitest";
import { createLanguage } from "../parser/index.js";
import { createShellEnvironment, executeShellCommand, executeShellSource, parseShellLine } from "../shell/index.js";
import {
  SHELL_COMMAND_SET_NAME,
  SHELL_OPERATOR_SET_NAME,
  SHELL_STATEMENT_SET_NAME,
  registerCommandSet,
  registerOperatorSet,
  registerStatementSet,
  shellStatementSet
} from "../shell/custom-language.js";

describe("shell eval command", () => {
  it("seeds default language registries in the shell environment", () => {
    const environment = createShellEnvironment();

    const operatorSet = environment.operatorSets.get(SHELL_OPERATOR_SET_NAME);
    const commandSet = environment.commandSets.get(SHELL_COMMAND_SET_NAME);
    const statementSet = environment.statementSets.get(SHELL_STATEMENT_SET_NAME);

    expect(operatorSet).toBeDefined();
    expect(commandSet).toBeDefined();
    expect(statementSet).toBeDefined();
    expect(commandSet?.commands.echo).toBeDefined();
    expect(statementSet).toMatchObject({
      allowAssignmentStatements: true
    });
    expect(statementSet?.commandSet.commands.echo).toBeDefined();
    expect(statementSet?.operatorSet.infixOperators["+"]).toBeDefined();
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
      registerCommandSet(environment.commandSets, SHELL_COMMAND_SET_NAME, {
        commands: {}
      })
    ).toThrowError(`Cannot redefine command set '${SHELL_COMMAND_SET_NAME}'`);

    expect(() =>
      registerStatementSet(environment.statementSets, SHELL_STATEMENT_SET_NAME, shellStatementSet)
    ).toThrowError(`Cannot redefine statement set '${SHELL_STATEMENT_SET_NAME}'`);
  });

  it("declares operator, command, and statement sets", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("opset math_ops { prefix ! precedence 9 infix %% precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmdset calc_cmds { echo eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("stmtset calc_stmt commands calc_cmds operators math_ops"),
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
    expect(environment.commandSets.get("calc_cmds")).toMatchObject({
      strictCommands: true
    });
    expect(environment.commandSets.get("calc_cmds")?.commands.echo).toBeDefined();
    expect(environment.commandSets.get("calc_cmds")?.commands.eval).toBeDefined();
    expect(environment.statementSets.get("calc_stmt")).toMatchObject({
      commandSet: {
        strictCommands: true
      },
      operatorSet: {
        prefixOperators: {
          "!": { precedence: 9 }
        }
      }
    });
  });

  it("rejects duplicate opset, cmdset, and stmtset declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("opset shell_ops { prefix ! precedence 9 }"),
        environment
      )
    ).toThrowError(`Cannot redefine operator set '${SHELL_OPERATOR_SET_NAME}'`);

    expect(() =>
      executeShellCommand(
        parseShellLine("cmdset shell_cmds { echo }"),
        environment
      )
    ).toThrowError(`Cannot redefine command set '${SHELL_COMMAND_SET_NAME}'`);

    expect(() =>
      executeShellCommand(
        parseShellLine("stmtset shell_stmt commands shell_cmds operators shell_ops"),
        environment
      )
    ).toThrowError(`Cannot redefine statement set '${SHELL_STATEMENT_SET_NAME}'`);
  });

  it("rejects unknown command references in cmdset declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("cmdset broken_cmds { echo missing_command }"),
        environment
      )
    ).toThrowError("Unknown command 'missing_command'");
  });

  it("rejects unsupported cmdset body constructs explicitly", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("cmdset composed_cmds { import echo }"),
        environment
      )
    ).toThrowError("Unsupported command set construct 'import'");

    expect(() =>
      executeShellCommand(
        parseShellLine("cmdset dup_cmds { echo echo }"),
        environment
      )
    ).toThrowError("Duplicate command 'echo' in command set body");
  });

  it("rejects unsupported opset body constructs explicitly", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("opset bad_ops { postfix ! precedence 9 }"),
        environment
      )
    ).toThrowError("Unsupported operator definition kind 'postfix'");

    expect(() =>
      executeShellCommand(
        parseShellLine("opset bad_ops { infix + precedence 7 center }"),
        environment
      )
    ).toThrowError("Unsupported infix associativity 'center'");
  });

  it("rejects unknown named set references in stmtset declarations", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellCommand(
        parseShellLine("stmtset broken_stmt commands missing_cmds operators shell_ops"),
        environment
      )
    ).toThrowError("Unknown command set 'missing_cmds'");

    expect(() =>
      executeShellCommand(
        parseShellLine("stmtset broken_stmt commands shell_cmds operators missing_ops"),
        environment
      )
    ).toThrowError("Unknown operator set 'missing_ops'");
  });

  it("parses eval expression with spaces as a single argument", () => {
    const statement = parseShellLine("eval 1 + 2 * 3");
    expect(statement.kind).toBe("command");
    if (statement.kind !== "command") throw new Error("expected command");
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

  it("uses selected operator sets when invoking user commands", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("opset math_ops { infix + precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd --evaluate math_ops show value { eval $value }"),
      environment
    );

    const output = executeShellCommand(parseShellLine("show 1 + 2"), environment);
    expect(output).toBe("3");
  });

  it("executes command bodies in the selected statement set", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("cmdset eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("stmtset eval_stmt commands eval_only operators shell_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd calc value { eval $value } :: eval_stmt"),
      environment
    );

    const output = executeShellCommand(parseShellLine("calc 3"), environment);
    expect(output).toBe("3");
  });

  it("rejects unsupported commands inside a custom command body language", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("cmdset eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("stmtset eval_stmt commands eval_only operators shell_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd broken { echo nope } :: eval_stmt"),
      environment
    );

    expect(() => executeShellCommand(parseShellLine("broken"), environment)).toThrowError("Unknown command 'echo'");
  });

  it("inherits the selected statement set into nested blocks inside command bodies", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("cmdset if_eval_only { if eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("stmtset if_eval_stmt commands if_eval_only operators shell_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd nested { if 1 then { echo nope } } :: if_eval_stmt"),
      environment
    );

    expect(() => executeShellCommand(parseShellLine("nested"), environment)).toThrowError("Unknown command 'echo'");
  });

  it("resolves named operator and statement sets when defining commands", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("opset math_ops { infix %% precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmdset eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("stmtset eval_stmt commands eval_only operators math_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd --evaluate math_ops calc { eval 1 %% 2 } :: eval_stmt"),
      environment
    );

    const definition = environment.commands.get("calc");
    expect(definition?.argumentOperatorSet).toMatchObject({
      infixOperators: {
        "%%": { precedence: 7, associativity: "left" }
      }
    });
    expect(definition?.bodyLanguage).toMatchObject({
      commandSet: {
        strictCommands: true
      }
    });
    expect(definition?.bodyLanguage?.commandSet.commands.eval).toBeDefined();
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
        parseShellLine("cmd broken { echo hi } :: missing_stmt"),
        environment
      )
    ).toThrowError("Unknown statement set 'missing_stmt'");
  });

  it("captures resolved body language at command declaration time", () => {
    const environment = createShellEnvironment();

    executeShellCommand(
      parseShellLine("opset math_ops { infix %% precedence 7 left }"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmdset eval_only { eval }"),
      environment
    );
    executeShellCommand(
      parseShellLine("stmtset eval_stmt commands eval_only operators math_ops"),
      environment
    );
    executeShellCommand(
      parseShellLine("cmd --evaluate math_ops calc { eval 1 %% 2 } :: eval_stmt"),
      environment
    );

    const definition = environment.commands.get("calc");
    expect(definition?.argumentOperatorSet?.infixOperators["%%"]).toMatchObject({
      precedence: 7,
      associativity: "left"
    });
    expect(definition?.bodyLanguage?.commandSet.commands.eval).toBeDefined();

    const shellCommands = environment.commandSets.get(SHELL_COMMAND_SET_NAME);
    const shellOperators = environment.operatorSets.get(SHELL_OPERATOR_SET_NAME);
    if (!shellCommands || !shellOperators) {
      throw new Error("expected seeded shell language registries");
    }

    environment.statementSets.set(
      "eval_stmt",
      createLanguage({
        commandSet: {
          commands: {
            echo: shellCommands.commands.echo!
          },
          strictCommands: true
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
    expect(definition?.bodyLanguage?.commandSet.commands.eval).toBeDefined();
    expect(definition?.bodyLanguage?.commandSet.commands.echo).toBeUndefined();
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
    ).toThrowError("Expected statement set name after '::'");
  });

  it("rejects disallowed commands inside custom statement sets in end-to-end shell source execution", () => {
    const environment = createShellEnvironment();

    expect(() =>
      executeShellSource(
        [
          "cmdset eval_only { eval }",
          "stmtset eval_stmt commands eval_only operators shell_ops",
          "cmd broken { echo nope } :: eval_stmt",
          "broken"
        ].join("\n"),
        environment
      )
    ).toThrowError("Unknown command 'echo'");
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
