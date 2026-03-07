import { parseExpressionFromTokens, type ExpressionNode } from "../../parser/index.js";
import { scan } from "../../scanner/index.js";
import { expressionConfig } from "../expression-config.js";

export function parseStatementExpressionSource(source: string): ExpressionNode {
  return parseExpressionFromTokens(scan(source), expressionConfig);
}
