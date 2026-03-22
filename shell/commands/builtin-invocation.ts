import { expressionConfig } from "../../lang/expression-config.js";
import {
  extractNestedBlock,
  isIgnorable,
  parseCommandDeclaration,
  parseExpressionFromTokens,
  parseInvocation,
  validateInvocation,
  type ArgumentValue,
  type CommandArguments,
  type CommandNode,
  type ParsedArguments
} from "../../parser/index.js";
import { scan } from "../../scanner/index.js";

type BuiltinCommandName = "cd" | "echo" | "eval" | "for";

const BUILTIN_DECLARATION_SOURCES: Record<BuiltinCommandName, string> = {
  cd: "cd path { }",
  echo: "echo ... { }",
  eval: "eval ... { }",
  for: "for iterator (from ...) (to ...) [step ...] (do block) { }"
};

const BUILTIN_DECLARATIONS = Object.fromEntries(
  Object.entries(BUILTIN_DECLARATION_SOURCES).map(([name, source]) => [name, parseCommandDeclaration(scan(source))])
) as Record<BuiltinCommandName, ReturnType<typeof parseCommandDeclaration>>;

function parseExpressionValue(raw: string) {
  const tokens = scan(raw).filter((token) => !isIgnorable(token));
  return parseExpressionFromTokens(tokens, {
    prefixOperators: expressionConfig.prefixOperators,
    infixOperators: expressionConfig.infixOperators
  });
}

function parseNestedBlockValue(raw: string) {
  const trimmed = raw.trim();
  const block = extractNestedBlock(trimmed);
  const trailing = trimmed.slice(block.closeIndex + 1).trim();
  if (trailing.length > 0) {
    throw new Error("Unexpected content after nested block");
  }

  return {
    kind: "nested-block" as const,
    content: block.content
  };
}

function asString(value: ArgumentValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function clauseOccurrence(args: ParsedArguments, keyword: string): ParsedArguments | undefined {
  const occurrences = args.clauses[keyword];
  return occurrences && occurrences.length > 0 ? occurrences[0] : undefined;
}

function joinValues(values: ArgumentValue[]): string {
  return values.map((value) => asString(value)).filter((value) => value.length > 0).join(" ");
}

function translateEvalLikeArgs(parsed: ParsedArguments): CommandArguments {
  const expressionSource = joinValues(parsed.varArgs);
  return {
    expression: parseExpressionValue(expressionSource)
  };
}

function translateForArgs(parsed: ParsedArguments): CommandArguments {
  const iteratorRaw = asString(parsed.namedArgs.iterator);
  const fromClause = clauseOccurrence(parsed, "from");
  const toClause = clauseOccurrence(parsed, "to");
  const stepClause = clauseOccurrence(parsed, "step");
  const doClause = clauseOccurrence(parsed, "do");

  const fromRaw = joinValues(fromClause?.varArgs ?? []);
  const toRaw = joinValues(toClause?.varArgs ?? []);
  const stepRaw = joinValues(stepClause?.varArgs ?? []);
  const doRaw = doClause ? asString(doClause.namedArgs.block) : "";

  const args: CommandArguments = {
    iterator: parseExpressionValue(iteratorRaw),
    from: parseExpressionValue(fromRaw),
    to: parseExpressionValue(toRaw),
    do: parseNestedBlockValue(doRaw)
  };

  if (stepRaw.length > 0) {
    args.step = parseExpressionValue(stepRaw);
  }

  return args;
}

function translateBuiltInArgs(name: BuiltinCommandName, parsed: ParsedArguments): CommandArguments {
  switch (name) {
    case "cd":
      return {
        path: asString(parsed.namedArgs.path)
      };
    case "echo":
      return {
        extras: parsed.varArgs
      };
    case "eval":
      return translateEvalLikeArgs(parsed);
    case "for":
      return translateForArgs(parsed);
  }
}

export function translateBuiltInInvocation(command: CommandNode): CommandNode {
  if (!(command.name in BUILTIN_DECLARATIONS)) {
    return command;
  }

  const builtInName = command.name as BuiltinCommandName;
  const declaration = BUILTIN_DECLARATIONS[builtInName];
  const invocation = parseInvocation(scan(command.raw), declaration);
  validateInvocation(invocation, declaration);

  return {
    ...command,
    args: translateBuiltInArgs(builtInName, invocation.arguments)
  };
}