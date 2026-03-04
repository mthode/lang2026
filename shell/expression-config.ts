import type { ExpressionParserConfig } from "../parser/index.js";

export const shellExpressionConfig: ExpressionParserConfig = {
  prefixOperators: {
    "+": { precedence: 9 },
    "-": { precedence: 9 },
    "!": { precedence: 9 },
    "~": { precedence: 9 }
  },
  infixOperators: {
    ",": { precedence: 1 },
    "=": { precedence: 2, associativity: "right" },
    "||": { precedence: 3 },
    "&&": { precedence: 4 },
    "==": { precedence: 5 },
    "!=": { precedence: 5 },
    "<": { precedence: 6 },
    ">": { precedence: 6 },
    "<=": { precedence: 6 },
    ">=": { precedence: 6 },
    "+": { precedence: 7 },
    "-": { precedence: 7 },
    "*": { precedence: 8 },
    "/": { precedence: 8 },
    "%": { precedence: 8 }
  }
};
