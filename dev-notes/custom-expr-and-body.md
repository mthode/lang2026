# Custom Expression And Body Language Spec

## Goal

Define the behavior for user-declared commands that:

- parse their invocation arguments with a named operator set
- parse their `{ ... }` body with a named statement set
- refer to named language objects instead of embedding operator or command definitions inline

This note is primarily about observable behavior and declaration syntax. The implementation plan at the end maps that behavior onto the current codebase.

## Summary

User-declared commands gain two independent language hooks:

- an argument operator set, used to reduce invocation tokens into argument values before those values are bound to the command's declared arguments
- a body statement set, used to parse and execute the command body as its own language

Those hooks refer to named, first-class objects:

- `opset`: a named operator set
- `cmdset`: a named command set
- `stmtset`: a named statement set

The command declaration only names the sets it wants to use. It does not define operators or commands inline.

## First-Class Language Objects

### Operator sets

An operator set is a named collection of operator definitions.

Behaviorally, an operator set answers these questions:

- which tokens are valid prefix operators
- which tokens are valid infix operators
- operator precedence
- operator associativity where relevant

An operator set is used directly by command declarations and statement sets whenever they need custom expression parsing.

### Command sets

A command set is a named collection of commands that are legal inside a statement language.

Behaviorally, a command set answers these questions:

- which command names may appear at statement position
- whether unknown commands are rejected or fall through to a default command rule

For this spec, the important behavior is that a statement set names a command set, and that command set controls which commands are valid in the body language.

### Statement sets

A statement set is a named statement language.

At minimum, a statement set names:

- the command set used to recognize statements
- the operator set used by expression-bearing statements in that language

A statement set may later include more policy, but for this spec it is the language object that owns the meaning of a command body.

## Command Declaration Extension

User-declared commands keep their existing argument declaration grammar and gain two optional language references:

- `--evaluate <OpSetName>`
- a statement-set spec that is attached to the body it customizes

The operator-set reference appears before the command name so it stays clearly separate from `ArgDecls`. The statement-set reference should belong to the body surface, not to the argument declaration region.

### Proposed shape

```ebnf
CommandDefn ::= "cmd" ArgExprSpec? QualifierDecl* CommandName ArgDecls BodyWithSpec

ArgExprSpec ::= "--evaluate" Name

BodyWithSpec ::= Body BodyStmtSpec?
BodyStmtSpec ::= "::" Name
Body ::= "{" CommandSet "}"
CommandSet ::= zero or more Command entries in the selected statement language
Command ::= a command recognized by the selected command set
```

This keeps the expression hook out of the argument declaration space while making the body-language hook visually belong to the brace block it affects.

### Recommended direction for body-bound syntax

The strongest default is:

```ebnf
BodyStmtSpec ::= "::" Name
BodyWithSpec ::= "{" CommandSet "}" ("::" Name)?
```

This yields:

```text
cmd render name {
  text "Hello"
  slot name
} :: template_stmt
```

This is the recommended direction because:

- it reads like a type annotation on the body
- it leaves `ArgDecls` visually untouched
- it extends naturally if a future command has more than one body

If multiple body sections are added later, each body can carry its own statement-set spec:

```text
cmd choose condition then { ... } :: then_lang else { ... } :: else_lang
```

The section labels such as `then` and `else` are future work. The important groundwork is that the statement-set spec is owned by an individual body.

### Examples

```text
cmd --evaluate math_ops my_math value {
  echo $value
}

cmd render name {
  text "Hello"
  slot name
} :: template_stmt

cmd --evaluate shell_ops pipeline first second {
  run first
  run second
} :: mini_shell
```

## Named Set Declaration Syntax

The exact token-level grammar for set declarations can still change, but the intended behavior is based on three top-level declaration forms:

```ebnf
OpSetDecl   ::= "opset" Name OpSetBody
CmdSetDecl  ::= "cmdset" Name CmdSetBody
StmtSetDecl ::= "stmtset" Name "commands" Name "operators" Name
```

The important part of this spec is the reference structure:

- `stmtset` refers to `cmdset` and `opset` by name
- `cmd` refers to `opset` and `stmtset` by name

No anonymous or inline expression, statement, operator, or command sets are allowed in a command declaration.

## Invocation Semantics For Command Arguments

## Core rule

If a command declares `--evaluate <OpSetName>`, its invocation arguments are parsed with that operator set before argument binding occurs.

That means the invocation parser must not treat whitespace-separated tokens as final argument boundaries for expression-valued arguments. Instead, expression parsing reduces a run of tokens into one argument value, and only then is that value assigned to the command's declared argument slots.

### Observable behavior

Given:

```text
opset math_ops { infix + precedence 7 left }
cmd --evaluate math_ops my_math value { echo $value }
```

Then:

```text
my_math 2 + 2
```

behaves as if the command received one argument whose source expression is `2 + 2`, not three separate arguments `2`, `+`, and `2`.

### Processing order

For a command invocation with a custom argument operator set, the observable order is:

1. Tokenize the invocation.
2. Resolve qualifiers and the command name.
3. Recognize clause keywords that belong to the declaration.
4. For each value-bearing slot in the current clause, parse the next value using the command's selected operator set.
5. Bind the reduced expression values to named, unnamed, optional, vararg, and keyed-clause argument slots.

This preserves the existing declaration model while changing what counts as one argument value.

### Boundary rule

Within a clause, one expression argument consumes the longest token sequence that forms one complete expression under the selected operator set, while still leaving enough input to satisfy later required parts of the same clause.

This gives deterministic results for declarations such as:

```text
cmd --evaluate math_ops pair left right { ... }
pair 1 + 2 3 + 4
```

which binds:

- `left = 1 + 2`
- `right = 3 + 4`

The same rule applies inside keyed clauses and varargs.

### Keyword disambiguation

Clause keywords still win over expression parsing when they appear in a position where the declaration allows a clause transition.

So expression parsing does not consume tokens that should start a keyed clause.

For example, if `to` is a keyed clause keyword, then:

```text
send 1 + 2 to admin
```

binds the expression `1 + 2` to the preceding slot and starts the `to` clause at `to`.

Quoted strings remain values and are never interpreted as clause keywords.

### Default behavior

If `--evaluate <OpSetName>` is omitted, command arguments use the ambient expression behavior already defined by the host language.

In other words, the custom operator set is opt-in per command.

## Body Semantics

## Core rule

If a command attaches a statement-set spec to a body, the text inside that `{ ... }` body is parsed and executed as that statement set's language.

The command body is therefore not locked to the host shell language. A command may introduce a different body language while remaining callable from the outer shell.

### Observable behavior

Given:

```text
cmdset template_cmds { text slot repeat }
stmtset template_stmt commands template_cmds operators template_ops

cmd render name {
  text "Hello"
  slot name
} :: template_stmt
```

The body is interpreted using `template_stmt`, not the default shell parser.

### Statement-set ownership

The selected statement set controls:

- which commands are legal at statement position inside the body
- how expression-bearing statements inside that body parse their expressions
- how nested `{ ... }` blocks inside that body are interpreted

By default, nested blocks inside a body inherit the same statement set unless the enclosing statement form explicitly says otherwise.

### Independence from argument expression parsing

The argument operator set and the body statement set are independent.

This is valid and intentional:

```text
cmd --evaluate math_ops report value {
  text "Result"
  slot value
} :: template_stmt
```

Here the invocation arguments use `math_ops`, while the body uses `template_stmt`.

### Default behavior

If a body-bound statement-set spec is omitted, the command body uses the host language's normal body parsing behavior.

## Name Resolution And Lifetime

All language references are by name, but the binding behavior should be explicit.

This spec adopts the following rule:

- named sets are resolved when the declaring object is created
- a command captures the referenced operator set and statement set at command declaration time
- a statement set captures its referenced command set and operator set when it is declared
- later redefinition of a set name does not retroactively change already-declared commands or statement sets

This gives stable behavior and avoids commands silently changing meaning because some shared language object was redefined later.

## Validation Rules

The following are specification-level errors:

- a `cmd` references an unknown `opset`
- a `cmd` references an unknown `stmtset`
- a `stmtset` references an unknown `cmdset`
- a `stmtset` references an unknown `opset`
- duplicate names within the same object kind are not allowed
- inline operator definitions inside `cmd`
- inline command-set definitions inside `cmd`

The following are semantic constraints on behavior:

- argument expression parsing must be deterministic for a given declaration and token stream
- clause keywords are recognized before they can be swallowed by an expression parse
- body parsing must reject commands that are not present in the selected command set
- nested blocks inside a statement set inherit that same statement set unless another rule explicitly overrides it

## Resulting Mental Model

After this change, a user-declared command has three layers of language behavior:

1. the outer shell language used to declare the command
2. the operator-defined expression language used when invoking the command's arguments
3. the statement language used when executing the command body

Those languages are connected by named references rather than by inline syntax.

## Deferred Questions

These questions are intentionally left for later design and implementation work:

- the exact concrete syntax inside `opset` and `cmdset` bodies
- whether set declarations are allowed only at top level or also inside nested scopes
- whether command sets support import, extension, or composition
- how body-language variables and command arguments are surfaced to a custom statement runtime
- whether custom statement sets can introduce non-command statement forms beyond the existing command-line model

The behavior above should remain stable even if the internal representation or declaration surface is adjusted later.

## Implementation Plan

The implementation should be done in small phases so that command declaration parsing, named language object registration, invocation parsing, and body execution can each be validated independently.

### Phase 1: Add language-object runtime types and registries

**Files:** `shell/commands/types.ts`, `shell/index.ts`, possibly a new shared type file such as `lang/custom-language.ts`

- Define runtime shapes for `OperatorSetDefinition`, `CommandSetDefinition`, and `Language`.
- Extend `ShellEnvironment` with maps for named operator sets, command sets, and statement sets.
- Seed the environment with at least one default operator set and one default statement set that reflect the current shell behavior.
- Keep the first release simple: named sets are resolved from these registries, not computed ad hoc.

**Tests:** Add shell-environment tests that verify the default registries exist and that duplicate-name checks behave as expected.

### Phase 1B: Refactor language-object types toward the parser layer

Status: complete.

This refactor is implemented. The parser now owns the reusable language-definition model, the shell layer consumes those parser-owned types for registry bootstrapping, and focused parser and shell tests cover the representation boundaries described below. Remaining implementation work for this feature starts at Phase 2.

The syntax for declaring `opset`, `cmdset`, and `stmtset` belongs in the shell layer because those declarations are shell commands. The language objects being declared do not. They are parser-facing constructs and should live alongside the rest of the parsing model.

The current codebase already has several parser objects that serve roles very close to the new Phase 1 shell registries. Before adding more declaration and execution features, those abstractions should be aligned so the parser remains the source of truth for language definition.

#### Current parsing-pipeline objects and their roles

- `ExpressionParserConfig` in `parser/expression.ts`
  Provides the operator tables used by expression parsing: prefix operators and infix operators.

- `ExpressionOperatorOverrides` in `parser/expression.ts`
  Provides per-argument operator overrides layered on top of an ambient expression config.

- `Language` in `parser/command.ts`
  Describes a statement language scope: operator tables, command definitions, assignment support, strict-command behavior, and the fallback command definition.

- `ParserConfig` in `parser/command.ts`
  The top-level parser construction input. It is effectively a required form of parser scope plus parser-global defaults.

- `ResolvedParserScope` in `parser/command.ts`
  The normalized internal scope used while parsing. It is produced by combining the top-level parser config with nested overrides.

- `CommandDefinition` in `parser/command.ts`
  Describes how one statement-form command parses its arguments in a given statement language.

- `CommandArgumentDefinition` and `ArgumentInfo` in `parser/command.ts`
  Describe the parse behavior of individual arguments, including nested-block scope overrides and expression-operator overrides.

- `NestedBlockNode.scope` in `parser/command.ts`
  Carries a parser scope forward so a nested body can later be parsed in the correct language.

- `CommandDeclaration` in `parser/declaration.ts`
  Describes a user-declared command's invocation grammar: qualifiers, positional arguments, keyed clauses, varargs, and the raw body block.

- `ParsedCommand` and `ParsedArguments` in `parser/declaration.ts`
  Describe the result of parsing an invocation against a `CommandDeclaration`.

- `parseInvocation(...)` and `validateInvocation(...)` in `parser/invocation.ts`
  Apply a `CommandDeclaration` to invocation tokens and enforce its semantic rules.

- `shell/custom-language.ts`
  Currently introduces `OperatorSetDefinition`, `CommandSetDefinition`, and seeded shell language registries. These are parser-facing concepts, but the shell layer still bootstraps the built-in shell instances.

#### Relationship summary

- `OperatorSetDefinition` is conceptually a named wrapper around the operator-table part of `ExpressionParserConfig`.
- `CommandSetDefinition` is conceptually a named wrapper around the command-table part of `Language`, plus `strictCommands` and `defaultCommand` behavior.
- `Language` is the reusable executable statement-language shape assembled from operator definitions, command definitions, and parser behavior flags.
- `NestedBlockNode.scope` is already the mechanism that propagates statement-language context into deferred body parsing.
- `CommandDeclaration` is the bridge between shell-level declaration syntax and parser-level language objects.

The overlap is useful, but leaving both models independent would create two competing representations of the same parsing concepts. The refactor goal is therefore to let the parser layer own the reusable language-definition types, while the shell layer owns only declaration syntax, runtime registration, and execution.

#### Refactor plan

##### Phase 1B-1: Introduce parser-owned named language-object types

**Files:** new parser module such as `parser/language.ts`, plus `parser/index.ts`

- Move or recreate `OperatorSetDefinition`, `CommandSetDefinition`, and `Language` under the parser directory.
- Export these types from `parser/index.ts` so both shell code and future parser helpers use one shared definition source.
- Keep the first move type-only if necessary to minimize churn.

##### Phase 1B-2: Define explicit conversion boundaries to existing parser objects

**Files:** likely `parser/language.ts` and `parser/command.ts`

- Add helper functions that convert:
  - `OperatorSetDefinition` -> `ExpressionParserConfig` operator tables
  - `CommandSetDefinition` -> the command-related part of `Language`
  - named operator and command sets -> a resolved `Language`
- Make these conversions explicit rather than scattering ad hoc object reshaping throughout the shell runtime.

##### Phase 1B-3: Remove the old `ParserDefinition` split

**Files:** `parser/language.ts`, `parser/command.ts`

- Complete the rename so the parser's executable statement-language type is `Language` everywhere.
- Ensure registry entries key languages by external name rather than requiring a `name` field inside the language object itself.
- Do not collapse them prematurely if that would blur the difference between unresolved references and resolved parse scope.

##### Phase 1B-4: Move shell registry helpers to depend on parser-owned types

**Files:** `shell/custom-language.ts`, `shell/commands/types.ts`, `shell/index.ts`

- Update the shell registry module to import the language-object types from the parser directory.
- Keep shell-specific seeded values such as the built-in shell language definitions in the shell layer.
- Rename or slim helper modules as needed so the shell layer clearly looks like a bootstrapper of parser-owned language objects, not the owner of those types.

##### Phase 1B-5: Revisit nested block scope propagation

**Files:** `parser/command.ts`, `shell/utils/body.ts`, later `shell/commands/command.ts`

- Confirm that `NestedBlockNode.scope` remains the right resolved representation for body-language inheritance.
- If needed, separate unresolved statement-set references from resolved `Language` instances so declaration-time capture and execution-time parsing remain explicit.

##### Phase 1B-6: Add focused tests for representation boundaries

**Files:** `test/parser.test.ts`, `test/shell.test.ts`

- Add parser tests for the new shared language-object conversion helpers.
- Keep shell tests focused on registry seeding and runtime behavior, not on validating parser-owned type semantics.
- Use these tests to ensure the refactor does not change current shell parsing behavior before later phases add new syntax.

#### Refactor outcome

After Phase 1B:

- the parser directory owns the reusable language-definition model
- the shell directory owns declaration syntax, built-in shell seeded values, and runtime registration
- later phases can implement `opset`, `cmdset`, `stmtset`, `--evaluate`, and `:: Name` without introducing a second competing parsing model

### Phase 2: Add declaration commands for `opset`, `cmdset`, and `stmtset`

**Files:** `shell/index.ts`, new command executors under `shell/commands/`, parser-owned language-object helpers under `parser/`

- Add built-in commands `opset`, `cmdset`, and `stmtset`, each taking a raw declaration body the same way `cmd` and `func` already do.
- Register these commands in the shell parser config and command executor table.
- For the first implementation, keep declaration parsing local to these executors and produce validated runtime definitions that are stored in the environment registries.
- Reject duplicate names and unknown referenced names at declaration time.

**Tests:** Add shell tests covering successful declaration, duplicate declaration failure, and unknown-reference failure for each new declaration command.

### Phase 3: Extend `cmd` declaration parsing for `--evaluate` and `:: Name`

**Files:** `parser/declaration.ts`, `test/parser.test.ts`

- Extend `CommandDeclaration` with fields for the optional operator-set reference and optional body statement-set reference.
- Update `parseCommandDeclaration(...)` to recognize `cmd --evaluate Name ...` using the existing scanner tokenization of `"--"` followed by `evaluate`.
- Update body parsing to recognize a postfix `:: Name` immediately after the closing `}` and attach that name to the body.
- Keep the binding rule strict: the `:: Name` annotation applies only to the body that directly precedes it.
- Validate malformed combinations such as repeated `--evaluate` or repeated body annotations.

**Tests:** Add parser tests for successful parsing of both forms and for syntax errors around misplaced or duplicated annotations.

### Phase 4: Resolve named sets into parser scopes

**Files:** parser-owned language-object helpers plus `shell/commands/command.ts`

- Add a resolution layer that turns a named operator set into the `prefixOperators` and `infixOperators` config expected by the expression parser.
- Add a resolution layer that turns a statement set into a `Language` by combining its referenced command set and operator set.
- Reuse the existing `Language` and nested-scope machinery rather than building a second statement-parsing path.
- Resolve names when the owning declaration is created so commands capture stable behavior even if a set is later redefined.

**Tests:** Add focused tests for name resolution and capture semantics, especially that redefining a set name later does not silently change existing commands.

### Phase 5: Parse invocation arguments with the selected operator set

**Files:** `parser/invocation.ts`, `parser/declaration.ts`, `test/parser.test.ts`

- Upgrade invocation parsing so value-bearing slots are reduced using the operator set selected by the command declaration instead of simple whitespace segmentation.
- Preserve the existing clause-keyword behavior: clause keywords still terminate the current value and begin the next clause when allowed by the declaration.
- Implement the longest-complete-expression rule while still reserving enough input for trailing required arguments in the current clause.
- Ensure varargs continue to be greedy, but only over values that are valid under the current clause and selected operator set.
- Return parsed expression values in the invocation result so later execution phases no longer need to reconstruct expressions from raw strings.

**Tests:** Add parser tests for examples like `my_math 2 + 2`, multiple expression arguments in one invocation, keyword boundaries, vararg boundaries, and error cases for incomplete expressions.

### Phase 6: Execute bodies with the selected statement set

**Files:** `shell/commands/command.ts`, `shell/utils/body.ts`, `shell/commands/types.ts`

- Resolve the command body's optional `:: Name` annotation to a `Language` before executing the body.
- Pass that resolved scope into `executeBodyStatements(...)` so body parsing uses the selected statement set instead of the ambient shell parser.
- Ensure nested blocks parsed inside that body inherit the same statement-set scope by default unless a later statement form explicitly overrides it.
- Keep template-variable rendering separate from statement parsing so command argument substitution continues to work with custom body languages.

**Tests:** Add shell and scripting tests proving that a command body can run under a custom statement set and that unsupported commands are rejected inside that body.

### Phase 7: Define first-release declaration bodies for `opset` and `cmdset`

**Files:** new parser helpers plus tests

- Finalize the minimal concrete syntax for `opset` and `cmdset` bodies.
- Keep the first release intentionally narrow: enough to express operator definitions, command membership, and the statement-set references already described in this note.
- Avoid imports, extension, or composition in the first slice; those can be added later without blocking the core feature.

**Tests:** Add unit tests for each supported declaration form and reject unsupported body constructs explicitly.

### Phase 8: Integrate documentation and end-to-end coverage

**Files:** `parser/README.md`, `README.md`, relevant test files under `test/`

- Update the parser and shell documentation to show the new declaration forms.
- Add end-to-end tests that declare an operator set, declare a statement set, define a command using both, and then execute that command successfully.
- Add one failure-path end-to-end test for each major validation rule: unknown set names, invalid body annotation, and disallowed commands inside a custom statement set.

This sequence keeps the risky parser work isolated until the registry model and runtime resolution path are in place, and it ensures each slice has direct unit-test coverage before the next phase begins.