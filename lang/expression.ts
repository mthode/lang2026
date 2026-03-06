import type { ExpressionNode } from "../parser/index.js";
import { evaluateFunctionCallExpression } from "./function-processing.js";
import type { ExpressionRuntimeEnvironment } from "./types.js";

export function evaluateLangExpression(
  expression: ExpressionNode,
  environment: ExpressionRuntimeEnvironment
): number {
  if (expression.kind === "number") {
    return expression.value;
  }

  if (expression.kind === "identifier") {
    const value = environment.localVariables[expression.name] ?? environment.variables[expression.name];
    if (value === undefined) {
      throw new Error(`Unknown identifier '${expression.name}' in expression`);
    }
    return value;
  }

  if (expression.kind === "prefix") {
    const value = evaluateLangExpression(expression.right, environment);

    if (expression.operator === "+") return value;
    if (expression.operator === "-") return -value;

    throw new Error(`Unsupported prefix operator '${expression.operator}'`);
  }

  if (expression.kind === "binary") {
    const left = evaluateLangExpression(expression.left, environment);
    const right = evaluateLangExpression(expression.right, environment);

    if (expression.operator === "+") return left + right;
    if (expression.operator === "-") return left - right;
    if (expression.operator === "*") return left * right;
    if (expression.operator === "/") return left / right;

    throw new Error(`Unsupported binary operator '${expression.operator}'`);
  }

  if (expression.kind === "call") {
    return evaluateFunctionCallExpression(expression, environment, evaluateLangExpression);
  }

  throw new Error(`Unsupported expression kind '${expression.kind}'`);
}

export function stringifyExpression(expression: ExpressionNode): string {
  if (expression.kind === "number") return String(expression.value);
  if (expression.kind === "string") return expression.value;
  if (expression.kind === "identifier") return expression.name;
  if (expression.kind === "prefix") return `${expression.operator}${stringifyExpression(expression.right)}`;
  if (expression.kind === "binary") {
    return `${stringifyExpression(expression.left)} ${expression.operator} ${stringifyExpression(expression.right)}`;
  }
  if (expression.kind === "call") {
    return `${stringifyExpression(expression.callee)}(${expression.args.map((arg) => stringifyExpression(arg)).join(", ")})`;
  }

  return "";
}

export function renderTemplateVariables(
  template: string,
  values: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>
): string {
  let output = template;

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const rendered = Array.isArray(value)
      ? value.map((entry) => String(entry)).join(" ")
      : String(value);

    const pattern = new RegExp(`\\$${name}\\b`, "g");
    output = output.replace(pattern, rendered);
  }

  return output;
}

export function substituteStatementVariables(
  source: string,
  environment: Pick<ExpressionRuntimeEnvironment, "localVariables" | "variables">
): string {
  const replaceSegment = (segment: string): string => segment.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\b/g, (_match, name: string) => {
    const local = environment.localVariables[name];
    if (local !== undefined) {
      return String(local);
    }

    const fromEnvironment = environment.variables[name];
    if (fromEnvironment !== undefined) {
      return String(fromEnvironment);
    }

    return `$${name}`;
  });

  let output = "";
  let depth = 0;
  let segmentStart = 0;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "{") {
      if (depth === 0) {
        output += replaceSegment(source.slice(segmentStart, i));
        segmentStart = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0) {
          output += source.slice(segmentStart, i + 1);
          segmentStart = i + 1;
        }
      }
    }
  }

  if (segmentStart < source.length) {
    output += depth === 0
      ? replaceSegment(source.slice(segmentStart))
      : source.slice(segmentStart);
  }

  return output;
}
