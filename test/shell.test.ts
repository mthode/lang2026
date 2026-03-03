import { describe, expect, it } from "vitest";
import { createShellEnvironment, executeShellCommand, executeShellSource, parseShellLine } from "../shell/index.js";

describe("shell eval command", () => {
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

  it("supports optional positional function arguments", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd show a [b] { echo $a }"), environment);
    const call = parseShellLine("show 10");
    const callOutput = executeShellCommand(call, environment);
    expect(callOutput).toBe("10");
  });

  it("supports named function args and flags", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd cfg flag:0 x:1 y:2 { echo $flag $x $y }"), environment);
    const call = parseShellLine("cfg flag x 7 y 8 9");
    const callOutput = executeShellCommand(call, environment);
    expect(callOutput).toBe("true 7 8 9");
  });

  it("validates named argument arity in function calls", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd cfg2 x:2 { echo $x }"), environment);
    expect(() => executeShellCommand(parseShellLine("cfg2 x 1"), environment)).toThrowError("expects 2 values");
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
