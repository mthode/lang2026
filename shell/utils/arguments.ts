import { scan, type Token } from "../../scanner/index.js";

export interface SplitArgumentOptions {
  decodeStringLiterals?: boolean;
}

export function splitArgumentSegments(source: string, options: SplitArgumentOptions = {}): string[] {
  if (source.trim().length === 0) {
    return [];
  }

  const tokens = scan(source);
  const segments: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (token.value === "(" || token.value === "[" || token.value === "{") depth += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);

    if (depth === 0 && (token.type === "whitespace" || token.type === "newline" || token.type === "comment")) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    current.push(token);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments.map((segment) => renderSegment(segment, options));
}

function renderSegment(tokens: Token[], options: SplitArgumentOptions): string {
  if (options.decodeStringLiterals && tokens.length === 1 && tokens[0]?.type === "string") {
    return decodeStringLiteral(tokens[0].value);
  }

  return tokens.map((token) => token.value).join("");
}

function decodeStringLiteral(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  const endQuote = value[value.length - 1];
  if ((quote === '"' || quote === "'" || quote === "`") && quote === endQuote) {
    return value.slice(1, value.length - 1);
  }

  return value;
}
