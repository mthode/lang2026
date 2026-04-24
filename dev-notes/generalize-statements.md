# Generalize Parser Commands Into Statements

## Goal

Refactor the parser so its declaration and invocation model is about general-purpose `Statement`s instead of shell-specific commands.

The parser should own the complex logic:

- declaration parsing
- invocation parsing
- expression parsing for statement arguments
- generalized handling of nested blocks

The shell layer should become a thin specialization on top:

- shell commands are one kind of statement
- shell built-ins like `if`/`while`/`for` should be representable using the generalized statement model
- shell-specific execution should continue to live under `shell/`

This note describes the target shape and a staged refactoring plan. The immediate first step is intentionally small: rename parser-side `Command` concepts to `Statement` concepts, without renaming the shell-side command layer except where it must reference renamed parser types/functions.

## Current Shape

Today the code is split in a partly-generalized way:

- `parser/command.ts` already returns a top-level `StatementNode`
- `AssignmentStatementNode` is already parser-generic
- `parser/declaration.ts` and `parser/invocation.ts` are still centered on `CommandDeclaration` and `ParsedCommand`
- `NestedBlockNode` is treated as an argument value, which works for single-body commands but does not model multi-block statements very cleanly
- `shell/commands/command.ts` stores parser declarations directly and executes them as shell commands

The result is that the parser API still implies "a shell-like command with one body", even though some of the concepts are really broader than that.

## Desired Direction

### Core parser model

Introduce a parser-level `Statement` interface in place of parser-level `Command` naming.

At a high level:

```ts
interface StatementDeclaration {
  name: string;
  argumentOperatorSetName?: string;
  qualifiers: QualifierDecl[];
  argDecls: ArgDeclGroup;
  blocks: StatementBlockDecl[];
  primaryBlock?: string;
  globalKeywords: Set<string>;
}
```

The important change is that blocks become first-class declaration structure rather than being encoded as a single mandatory `body`.

### Blocks as statement structure

Commands always have an implementation body, but statements in general do not.

Examples:

- `cmd greet name { echo $name }` has one implementation block
- `declare x` should have no block at all
- `if condition then { ... } else { ... }` has two blocks

So the parser should not assume:

- every declaration has exactly one body
- a block is just another argument

Instead, blocks should be generalized in a way similar to keyed/named argument handling:

- declarations describe which block sections are allowed
- invocation parsing binds concrete nested blocks to those declared sections
- parsed output exposes bound blocks separately from ordinary scalar/raw/expression arguments

One possible shape:

```ts
interface StatementBlockDecl {
  name: string;
  required: boolean;
  allowMultiple?: boolean;
  statementSetName?: string;
}

interface ParsedStatement {
  statementName: string;
  qualifiers: Record<string, boolean>;
  arguments: ParsedArguments;
  blocks: Record<string, NestedBlockNode[]>;
}
```

The exact type names can change, but this separation is the important part.

## Design Principles

### 1. Parser names should be shell-neutral

Parser-level constructs should not use `Command*` names unless they are specifically shell-facing adapters.

Good parser names:

- `StatementDeclaration`
- `StatementNode`
- `ParsedStatement`
- `StatementDefinition`

Good shell names:

- `ShellCommandNode`
- `UserCommandDefinition`
- `executeUserCommand`

### 2. Complex parsing logic stays in `parser/`

The shell should not re-implement:

- clause parsing
- qualifier parsing
- argument binding
- block extraction/binding

The shell should mostly translate:

- parser `StatementDeclaration` -> shell `UserCommandDefinition`
- parser `ParsedStatement` -> shell execution inputs

### 3. Blocks and arguments should be parallel concepts

Arguments and blocks are both declared, parsed, and validated, but they are not the same thing.

Arguments:

- expression
- raw text
- ordinary value binding

Blocks:

- nested statement source
- optional attached language/scope
- intended for deferred execution

Treating blocks as a dedicated channel will make `if`-style and declaration-style statements much cleaner than forcing them through `ArgumentValue`.

### 4. The first step should be rename-first, behavior-light

The first implementation step should avoid redesigning the entire grammar at once.

We should first:

- rename parser-side `Command` concepts to `Statement`
- preserve current behavior as much as possible
- keep the existing single-body declaration model temporarily

Then we can generalize the structure in smaller follow-up steps.

## Proposed Stages

## Stage 1: Parser Rename With Minimal Behavior Change

This is the small first step requested for the refactor.

### Scope

Rename parser-side declaration/invocation constructs:

- `parser/command.ts` -> likely `parser/statement.ts`
- `CommandNode` -> `InvocationStatementNode` or `NamedStatementNode`
- `CommandDefinition` -> `StatementDefinition`
- `CommandArgumentDefinition` -> `StatementArgumentDefinition`
- `CommandDeclaration` -> `StatementDeclaration`
- `ParsedCommand` -> `ParsedStatement`
- `parseCommandDeclaration(...)` -> `parseStatementDeclaration(...)`

Keep shell terminology as-is where it is genuinely shell-specific:

- `shell/commands/*`
- `UserCommandDefinition`
- `executeUserCommand`

But update shell imports/usages to reference the renamed parser constructs.

### Constraints

For this stage:

- keep the current declaration grammar centered on a single body
- keep `body` on the declaration for now
- keep nested blocks flowing through current parsing behavior
- avoid changing shell runtime behavior

### Expected file touch points

- `parser/command.ts`
- `parser/declaration.ts`
- `parser/invocation.ts`
- `parser/index.ts`
- `parser/language.ts`
- `shell/index.ts`
- `shell/commands/types.ts`
- `shell/commands/command.ts`
- docs/tests that reference parser command types

### Why this stage matters

It removes the most misleading parser naming first and creates room for deeper structural changes without mixing rename noise with semantic changes.

## Stage 2: Separate Statement Blocks From Arguments

After the rename lands, generalize the declaration model so blocks are first-class.

### Parser changes

Replace:

- `body: NestedBlockNode`
- `bodyStatementSetName?: string`

With something closer to:

- `blocks: StatementBlockDecl[]`

For compatibility, a command-like declaration can initially desugar into:

- one required block named `body`

### Invocation changes

Parsed invocation results should carry:

- ordinary bound arguments
- bound block sections

instead of pretending blocks are only argument values.

This is the key change that unlocks:

- declarations with zero blocks
- declarations with multiple blocks
- per-block statement language metadata

### Validation changes

Generalize current validation rules so they cover both:

- argument clause structure
- block section requirements/cardinality

## Stage 3: Add a Thin Shell Command Adapter

Once parser statements are generalized, build a shell-specific adapter that narrows them back into commands.

### Target split

Parser:

- parses statement declarations
- parses statement invocations
- returns parser-generic structures

Shell:

- interprets a subset of statement declarations as executable shell commands
- requires an implementation block for user-defined shell commands
- converts parser block bindings into shell execution behavior

### Likely shape

The shell-side `cmd` implementation can validate something like:

- exactly one required implementation block
- that block maps to the command body

Then store a narrower shell type:

```ts
interface UserCommandDefinition {
  declaration: StatementDeclaration;
  implementationBlockName: string;
  argumentOperatorSet?: OperatorSetDefinition;
  bodyLanguage?: Language;
}
```

The parser stays broad; the shell adds the command-specific narrowing rules.

## Stage 4: Represent Shell Control Constructs As Generalized Statements

After block separation exists, revisit shell built-ins such as:

- `if`
- `while`
- `for`

The most important case is `if`, because it clearly demonstrates why blocks should not be modeled as a single `body` argument.

### Example target

Instead of shell-only special handling that treats `then` and `else` as nested-block arguments, model the statement more directly:

- scalar arguments: `condition`
- block sections: `then`, `else`

That keeps the parser generic while making shell execution simpler and more truthful.

## Stage 5: Support Blockless Statements / Declarations

Once block structure is explicit, allow statement declarations with no implementation block.

This is useful for declaration-like forms where the parser should capture structure but execution is handled elsewhere.

Examples:

- declaration statements
- metadata-only statements
- future compile-time constructs

At that point, "statement" is no longer just a euphemism for "command with one body".

## Suggested Order Of Implementation

1. Rename parser command concepts to statement concepts with minimal behavior changes.
2. Preserve a compatibility path where existing `cmd ... { body }` declarations still map to one required block.
3. Introduce first-class block declarations/bindings in parser types and invocation parsing.
4. Add shell-side narrowing rules so user-defined shell commands still require an implementation block.
5. Migrate shell built-ins that benefit from block separation, starting with `if`.
6. Expand tests and docs after each stage rather than in one large rewrite.

## Testing Plan

Every stage should include unit tests.

### Stage 1 tests

Update existing parser/shell tests to use renamed parser APIs while preserving behavior.

Focus on:

- parser declaration parsing still works after rename
- shell `cmd` declarations still execute as before
- shell imports/types compile cleanly against renamed parser types

### Stage 2+ tests

Add parser tests for:

- zero-block statements
- single-block statements
- multi-block statements
- per-block statement set binding
- invalid missing/duplicate blocks

Add shell tests for:

- command declarations still require the expected implementation block
- `if` with `then` and `else` maps cleanly onto generalized block parsing

## Open Questions

These do not block Stage 1, but they should be answered before Stage 2 is implemented.

### Block declaration syntax

How should multiple block sections be declared?

Possible directions:

- keep keyword-led argument grammar and add block markers after keywords
- let certain keyed clauses declare block payloads directly
- introduce a dedicated block declaration syntax parallel to `ArgDecls`

The best choice is the one that keeps invocation parsing deterministic and keeps declarations readable.

### Backward compatibility during refactor

Should old parser type names remain as temporary aliases for one step, or should the rename be immediate and repo-wide?

Given the early-stage status of the project, an immediate repo-wide rename is probably cleaner.

### Parsed invocation shape

Should parsed blocks live:

- inside `ParsedArguments` as a separate field, or
- alongside `arguments` at the top level of `ParsedStatement`

I prefer keeping blocks separate from ordinary arguments, because they have different lifecycle and execution semantics.

## Recommended Immediate Work

For the next change, keep the scope narrow:

1. Rename parser-side `Command` constructs to `Statement` constructs.
2. Do not rename shell command concepts except for imports/references to the renamed parser constructs.
3. Keep the single `body` model temporarily.
4. Add/update unit tests so the rename is covered.

That gives us a clean parser vocabulary first, which should make the follow-up block generalization much easier to reason about and review.
