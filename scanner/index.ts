export type TokenType =
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "delimiter"
  | "whitespace"
  | "comment"
  | "newline";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
}

export interface LogicalLine {
  content: string;
  startLine: number;
}

const delimiterChars = new Set(["(", ")", "[", "]", "{", "}", ",", ".", ";"]);
const operatorChars = new Set(["+", "-", "*", "/", "%", "=", "!", "<", ">", "&", "|", "^", "~", "?", ":"]);
const openingBracketChars = new Set(["(", "[", "{"]);
const closingBracketChars = new Set([")", "]", "}"]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r";
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

export function scan(input: string): Token[] {
  const tokens: Token[] = [];

  let i = 0;
  let line = 1;
  let column = 1;
  let bracketBalance = 0;

  const push = (type: TokenType, value: string, startLine: number, startColumn: number, offset: number): void => {
    tokens.push({ type, value, line: startLine, column: startColumn, offset });
  };

  while (i < input.length) {
    const ch = input[i] ?? "";
    const startLine = line;
    const startColumn = column;
    const startOffset = i;

    if (ch === "\\" && input[i + 1] === "\n") {
      push("whitespace", "\\\n", startLine, startColumn, startOffset);
      i += 2;
      line += 1;
      column = 1;
      continue;
    }

    if (ch === "\n") {
      push("newline", "\n", startLine, startColumn, startOffset);
      i += 1;
      line += 1;
      column = 1;
      continue;
    }

    if (isWhitespace(ch)) {
      let value = ch;
      i += 1;
      column += 1;

      while (i < input.length && isWhitespace(input[i] ?? "")) {
        value += input[i];
        i += 1;
        column += 1;
      }

      push("whitespace", value, startLine, startColumn, startOffset);
      continue;
    }

    if (ch === "#" || (ch === "/" && input[i + 1] === "/")) {
      const commentStartBalance = bracketBalance;
      let commentBalance = commentStartBalance;
      let value = ch;
      i += 1;
      column += 1;

      if (ch === "/") {
        value += "/";
        i += 1;
        column += 1;
      }

      while (i < input.length) {
        const curr = input[i] ?? "";

        if (curr === "\n") {
          if (commentBalance === commentStartBalance) {
            break;
          }
          value += curr;
          i += 1;
          line += 1;
          column = 1;
          continue;
        }

        if (openingBracketChars.has(curr)) {
          commentBalance += 1;
          value += curr;
          i += 1;
          column += 1;
          continue;
        }

        if (closingBracketChars.has(curr)) {
          if (commentBalance - 1 < commentStartBalance) {
            break;
          }
          commentBalance -= 1;
          value += curr;
          i += 1;
          column += 1;
          continue;
        }

        value += curr;
        i += 1;
        column += 1;
      }

      bracketBalance = commentBalance;

      push("comment", value, startLine, startColumn, startOffset);
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let value = ch;
      i += 1;
      column += 1;
      let escaped = false;

      while (i < input.length) {
        const curr = input[i] ?? "";
        value += curr;

        i += 1;

        if (curr === "\n") {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }

        if (escaped) {
          escaped = false;
          continue;
        }

        if (curr === "\\") {
          escaped = true;
          continue;
        }

        if (curr === quote) {
          break;
        }
      }

      push("string", value, startLine, startColumn, startOffset);
      continue;
    }

    if (isDigit(ch)) {
      let value = ch;
      i += 1;
      column += 1;

      while (i < input.length && /[0-9_.]/.test(input[i] ?? "")) {
        value += input[i];
        i += 1;
        column += 1;
      }

      push("number", value, startLine, startColumn, startOffset);
      continue;
    }

    if (isIdentifierStart(ch)) {
      let value = ch;
      i += 1;
      column += 1;

      while (i < input.length && isIdentifierPart(input[i] ?? "")) {
        value += input[i];
        i += 1;
        column += 1;
      }

      push("identifier", value, startLine, startColumn, startOffset);
      continue;
    }

    if (delimiterChars.has(ch)) {
      push("delimiter", ch, startLine, startColumn, startOffset);
      if (openingBracketChars.has(ch)) {
        bracketBalance += 1;
      } else if (closingBracketChars.has(ch)) {
        bracketBalance -= 1;
      }
      i += 1;
      column += 1;
      continue;
    }

    if (operatorChars.has(ch)) {
      let value = ch;
      i += 1;
      column += 1;

      while (i < input.length && operatorChars.has(input[i] ?? "")) {
        value += input[i];
        i += 1;
        column += 1;
      }

      push("operator", value, startLine, startColumn, startOffset);
      continue;
    }

    push("operator", ch, startLine, startColumn, startOffset);
    i += 1;
    column += 1;
  }

  return tokens;
}

export function splitLogicalLines(input: string): string[] {
  return splitLogicalLinesWithMetadata(input).map((line) => line.content);
}

export function splitLogicalLinesWithMetadata(input: string): LogicalLine[] {
  const lines = input.split("\n");
  const logicalLines: LogicalLine[] = [];

  let current = "";
  let bracketBalance = 0;
  let logicalStartLine = 1;

  const updateBalance = (lineText: string): void => {
    for (const ch of lineText) {
      if (ch === "(" || ch === "[" || ch === "{") bracketBalance += 1;
      else if (ch === ")" || ch === "]" || ch === "}") bracketBalance -= 1;
    }
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx] ?? "";
    const hasTrailingBackslash = rawLine.endsWith("\\");

    current += rawLine;
    updateBalance(rawLine);

    const isLastPhysicalLine = idx === lines.length - 1;

    if (!isLastPhysicalLine) {
      current += "\n";
    }

    if (hasTrailingBackslash || bracketBalance > 0) {
      continue;
    }

    if (current.trim().length > 0) {
      logicalLines.push({ content: current, startLine: logicalStartLine });
    }

    current = "";
    logicalStartLine = idx + 2;
  }

  if (current.trim().length > 0) {
    logicalLines.push({ content: current, startLine: logicalStartLine });
  }

  return logicalLines;
}
