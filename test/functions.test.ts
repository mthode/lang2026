import { describe, expect, it } from "vitest";
import { createShellEnvironment, executeShellCommand, parseShellLine } from "../shell/index.js";

describe("shell expression functions", () => {
  it("defines and invokes expression functions inside expressions", () => {
    const environment = createShellEnvironment();

    executeShellCommand(parseShellLine("func add ( a, b ) { a + b }"), environment);
    const output = executeShellCommand(parseShellLine("eval add(3, 4)"), environment);

    expect(output).toBe("7");
  });

  it("supports function-level if statements in function bodies", () => {
    const environment = createShellEnvironment();

    executeShellCommand(parseShellLine("func sign ( x ) { if x { 1 } else { -1 } }"), environment);

    const positive = executeShellCommand(parseShellLine("eval sign(12)"), environment);
    const zero = executeShellCommand(parseShellLine("eval sign(0)"), environment);

    expect(positive).toBe("1");
    expect(zero).toBe("-1");
  });

  it("supports function-level while statements in function bodies", () => {
    const environment = createShellEnvironment();

    executeShellCommand(parseShellLine("func countWhile ( n ) { while n - loop do { loop + 1 } }"), environment);

    const output = executeShellCommand(parseShellLine("eval countWhile(5)"), environment);
    expect(output).toBe("5");
  });

  it("supports function-level for statements in function bodies", () => {
    const environment = createShellEnvironment();

    executeShellCommand(parseShellLine("func lastInRange ( a, b ) { for i from a to b do { i } }"), environment);

    const output = executeShellCommand(parseShellLine("eval lastInRange(2, 5)"), environment);
    expect(output).toBe("5");
  });

  it("rejects zero step in function-level for statements", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("func badStep ( ) { for i from 1 to 3 step 0 do { i } }"), environment);

    expect(() => executeShellCommand(parseShellLine("eval badStep()"), environment)).toThrowError(
      "Function for-statement step cannot be 0"
    );
  });

  it("rejects calling a function where a command is expected", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("func onlyExpr ( x ) { x + 1 }"), environment);

    expect(() => executeShellCommand(parseShellLine("onlyExpr 10"), environment)).toThrowError(
      "Cannot execute function 'onlyExpr' as a command"
    );
  });

  it("rejects calling a command where a function is expected", () => {
    const environment = createShellEnvironment();
    executeShellCommand(parseShellLine("cmd greet name { echo $name }"), environment);

    expect(() => executeShellCommand(parseShellLine("eval greet(1)"), environment)).toThrowError(
      "Cannot call command 'greet' as a function"
    );
  });
});
