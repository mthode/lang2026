import { describe, expect, it } from "vitest";
import { scan, splitLogicalLines } from "../scanner/index.js";

describe("scanner", () => {
  it("tokenizes a mixed line with correct token positions", () => {
    const tokens = scan("foo (12 + bar)\n");

    expect(tokens).toEqual([
      { type: "identifier", value: "foo", line: 1, column: 1, offset: 0 },
      { type: "whitespace", value: " ", line: 1, column: 4, offset: 3 },
      { type: "delimiter", value: "(", line: 1, column: 5, offset: 4 },
      { type: "number", value: "12", line: 1, column: 6, offset: 5 },
      { type: "whitespace", value: " ", line: 1, column: 8, offset: 7 },
      { type: "operator", value: "+", line: 1, column: 9, offset: 8 },
      { type: "whitespace", value: " ", line: 1, column: 10, offset: 9 },
      { type: "identifier", value: "bar", line: 1, column: 11, offset: 10 },
      { type: "delimiter", value: ")", line: 1, column: 14, offset: 13 },
      { type: "newline", value: "\n", line: 1, column: 15, offset: 14 }
    ]);
  });

  it("emits all delimiter token values with correct positions", () => {
    const tokens = scan("(),.[]{};");
    expect(tokens.map((t) => t.type)).toEqual([
      "delimiter",
      "delimiter",
      "delimiter",
      "delimiter",
      "delimiter",
      "delimiter",
      "delimiter",
      "delimiter",
      "delimiter"
    ]);
    expect(tokens.map((t) => t.value)).toEqual(["(", ")", ",", ".", "[", "]", "{", "}", ";"]);
    expect(tokens.map((t) => t.column)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("emits operator tokens for arithmetic and comparison operators", () => {
    const tokens = scan("+ - * / % = == != < > <= >= && || ! ~ ? : ^ & |");
    const operators = tokens.filter((t) => t.type === "operator");

    expect(operators.map((t) => t.value)).toEqual([
      "+",
      "-",
      "*",
      "/",
      "%",
      "=",
      "==",
      "!=",
      "<",
      ">",
      "<=",
      ">=",
      "&&",
      "||",
      "!",
      "~",
      "?",
      ":",
      "^",
      "&",
      "|"
    ]);

    expect(operators[0]).toMatchObject({ line: 1, column: 1 });
    expect(operators[6]).toMatchObject({ line: 1, column: 13 });
    expect(operators[12]).toMatchObject({ line: 1, column: 29 });
  });

  it("emits number tokens with decimal and underscore forms", () => {
    const tokens = scan("1 23 4.5 6_000 7__8");
    const numbers = tokens.filter((t) => t.type === "number");

    expect(numbers.map((t) => t.value)).toEqual(["1", "23", "4.5", "6_000", "7__8"]);
    expect(numbers.map((t) => t.column)).toEqual([1, 3, 6, 10, 16]);
  });

  it("emits string tokens for single, double, and backtick quotes", () => {
    const tokens = scan("'a' \"b\" `c`");
    const strings = tokens.filter((t) => t.type === "string");

    expect(strings.map((t) => t.value)).toEqual(["'a'", '"b"', "`c`"]);
    expect(strings.map((t) => t.column)).toEqual([1, 5, 9]);
  });

  it("tracks line and column through multiline strings", () => {
    const tokens = scan("\"a\nb\" c");

    expect(tokens[0]).toMatchObject({ type: "string", value: "\"a\nb\"", line: 1, column: 1, offset: 0 });
    expect(tokens[1]).toMatchObject({ type: "whitespace", value: " ", line: 2, column: 3, offset: 5 });
    expect(tokens[2]).toMatchObject({ type: "identifier", value: "c", line: 2, column: 4, offset: 6 });
  });

  it("treats backslash newline as whitespace token", () => {
    const tokens = scan("eval 2 + \\\n3");

    expect(tokens[6]).toMatchObject({ type: "whitespace", value: "\\\n", line: 1, column: 10, offset: 9 });
    expect(tokens[7]).toMatchObject({ type: "number", value: "3", line: 2, column: 1, offset: 11 });
  });

  it("emits hash and slash comments and keeps newline tokens", () => {
    const tokens = scan("# first\n// second\n");

    expect(tokens[0]).toMatchObject({ type: "comment", value: "# first", line: 1, column: 1, offset: 0 });
    expect(tokens[1]).toMatchObject({ type: "newline", value: "\n", line: 1, column: 8, offset: 7 });
    expect(tokens[2]).toMatchObject({ type: "comment", value: "// second", line: 2, column: 1, offset: 8 });
    expect(tokens[3]).toMatchObject({ type: "newline", value: "\n", line: 2, column: 10, offset: 17 });
  });

  it("terminates comments before a close bracket that would drop below start balance", () => {
    const tokens = scan("(2 + 4 # this comment ) * 4");

    const comment = tokens.find((token) => token.type === "comment");
    expect(comment).toMatchObject({ type: "comment", value: "# this comment " });

    const commentIndex = tokens.findIndex((token) => token.type === "comment");
    expect(commentIndex).toBeGreaterThanOrEqual(0);
    expect(tokens[commentIndex + 1]).toMatchObject({ type: "delimiter", value: ")" });
  });

  it("allows multiline comments while comment-local bracket balance is above start", () => {
    const tokens = scan("eval 1 # comment opens {\nline two\nline three }\nnext");

    const commentIndex = tokens.findIndex((token) => token.type === "comment");
    expect(commentIndex).toBeGreaterThanOrEqual(0);
    expect(tokens[commentIndex]).toMatchObject({
      type: "comment",
      value: "# comment opens {\nline two\nline three }"
    });
    expect(tokens[commentIndex + 1]).toMatchObject({ type: "newline", value: "\n" });

    const nextIdentifier = tokens.find((token) => token.type === "identifier" && token.value === "next");
    expect(nextIdentifier).toBeDefined();
    expect(nextIdentifier).toMatchObject({ line: 4, column: 1 });
  });

  it("treats tab, space and carriage return as whitespace with correct position", () => {
    const tokens = scan("\t \r\nx");

    expect(tokens[0]).toMatchObject({ type: "whitespace", value: "\t \r", line: 1, column: 1, offset: 0 });
    expect(tokens[1]).toMatchObject({ type: "newline", value: "\n", line: 1, column: 4, offset: 3 });
    expect(tokens[2]).toMatchObject({ type: "identifier", value: "x", line: 2, column: 1, offset: 4 });
  });

  it("supports logical line continuation", () => {
    const lines = splitLogicalLines("run a \\\n b\nnext");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("run a \\\n b\n");
    expect(lines[1]).toBe("next");
  });

  it("supports logical lines with unbalanced brackets", () => {
    const lines = splitLogicalLines("eval (1 +\n 2)\nnext");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("eval (1 +\n 2)\n");
    expect(lines[1]).toBe("next");
  });

  it("emits ... as a single operator token", () => {
    const tokens = scan("...");
    expect(tokens).toEqual([
      { type: "operator", value: "...", line: 1, column: 1, offset: 0 },
    ]);
  });

  it("emits a lone . as a delimiter token", () => {
    const tokens = scan(".");
    expect(tokens).toEqual([
      { type: "delimiter", value: ".", line: 1, column: 1, offset: 0 },
    ]);
  });

  it("emits .. as two delimiter tokens", () => {
    const tokens = scan("..");
    expect(tokens).toEqual([
      { type: "delimiter", value: ".", line: 1, column: 1, offset: 0 },
      { type: "delimiter", value: ".", line: 1, column: 2, offset: 1 },
    ]);
  });

  it("does not treat ... inside a string literal as an operator", () => {
    const tokens = scan('"..."');
    expect(tokens).toEqual([
      { type: "string", value: '"..."', line: 1, column: 1, offset: 0 },
    ]);
  });

  it("emits ... with correct positions in context", () => {
    const tokens = scan("cmd echo _ ... {");
    const ellipsis = tokens.find((t) => t.value === "...");
    expect(ellipsis).toMatchObject({ type: "operator", value: "...", line: 1, column: 12, offset: 11 });
  });
});
