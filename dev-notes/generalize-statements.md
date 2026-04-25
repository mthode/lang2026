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

This note now records what is already implemented, what design boundary should remain in place, and what work is still left.

## Status
Completed work comes first in this note. Remaining work is called out separately below.

- [x] Parser-side command vocabulary has been renamed to statement vocabulary.
- [x] Parsed invocations expose blocks separately from ordinary arguments.
- [x] Statement declarations can have zero, one, or many declared blocks.
- [x] The shell uses a thin command-specific narrowing layer on top of parser-generic declarations.
- [x] Parser language vocabulary now uses `StatementSet` / `statementSet` / `defaultStatement` / `strictStatements`.
- [x] Shell registration commands now use `operators`, `statements`, and `language`.
- [x] Shell built-ins such as `if`, `while`, and `for` consume generalized statement shapes.
- [x] Blockless parser declarations are supported.
- [x] The remaining Stage 2 follow-up to finish the block declaration model is now complete: declaration-time block schema and invocation-time block metadata are both declarative.
- [x] A separate `stmt` shell command now exists for general statement declarations; `cmd` remains command-specific.

## Current Implemented Shape

Today the parser and shell are already mostly in the intended post-rename state.

Parser:

- parser nodes are statement-oriented rather than command-oriented
- declaration parsing returns `StatementDeclaration`
- invocation parsing returns `ParsedStatement`
- parsed blocks are exposed separately from ordinary arguments
- declaration validation and invocation validation both cover block structure

Shell:

- built-in shell commands consume the normal parser `NamedStatementNode` shape directly
- `cmd` narrows a parser declaration into an executable shell command definition
- language registration is split into `operators`, `statements`, and `language`

This means the design work is no longer a rename-first proposal. The rename and most of the structural follow-up are already in the codebase.

## Completed Work

### Parser Rename

- [x] `Command*` parser concepts were renamed to `Statement*` concepts.
- [x] Parser APIs now use names such as `StatementNode`, `StatementDefinition`, `StatementDeclaration`, and `ParsedStatement`.
- [x] Shell command terminology was kept where it is genuinely shell-specific, such as `UserCommandDefinition` and `executeUserCommand`.

This part of the refactor is complete.

### Blocks As A Separate Channel

- [x] Parsed invocations carry `arguments` and `blocks` separately.
- [x] Invocation-time block clauses such as `(then {})`, `[else {}]`, and `(do {})` are supported.
- [x] Declared statement blocks are stored as declaration metadata, while parsed invocations expose only invocation-bound blocks.
- [x] Validation covers block section presence and cardinality in addition to argument structure.

This is the main completed part of Stage 2. Blocks are no longer treated as just another ordinary argument path.

### Thin Shell Command Adapter

- [x] The parser stays broad and returns parser-generic declaration and invocation structures.
- [x] The shell narrows executable user commands in `cmd` rather than teaching the parser about shell-only runtime rules.
- [x] Executable shell commands still require exactly one required implementation block.

The important boundary here is intentional: `cmd` remains the shell command declaration form. It is not the general statement declaration form.

### Parser Language Vocabulary Rename

- [x] Parser language objects now use `StatementSetDefinition`.
- [x] Parser scope uses `statementSet` rather than `commandSet`.
- [x] Parser config uses `statements`, `defaultStatement`, and `strictStatements`.
- [x] The old parser vocabulary is no longer the primary model.

### Shell Language Registration Commands

- [x] Shell-facing declaration commands are now:

```text
operators shell_ops { ... }
statements shell_statements { echo eval if while }
language shell statements shell_statements operators shell_ops
```

- [x] The old registration command vocabulary is no longer the target shape.

### Shell Control Constructs As Generalized Statements

- [x] `if` is represented with a scalar condition plus block sections such as `then` and `else`.
- [x] `while` and `for` also use the generalized statement model.
- [x] Shell built-in executors consume the normal parser `NamedStatementNode` shape directly.
- [x] The old built-in translation layer is no longer needed.

Example current declaration style:

```text
cmd if condition (then {}) [else {}]
cmd while condition (do {})
cmd for iterator (from _) (to _) [step _] (do {})
```

### Blockless Parser Declarations

- [x] Statement declarations may have zero trailing blocks.
- [x] Invocation parsing returns an empty `blocks` record for blockless declarations.
- [x] Parser validation accepts blockless declarations.
- [x] Shell `cmd` intentionally rejects blockless declarations, because an executable shell command still requires one implementation block.

This boundary is also intentional: blockless declarations belong to the generalized statement model, not to executable shell commands declared by `cmd`.

## Current Design Boundary

The shell now keeps two different declaration surfaces:

- `cmd` declares executable shell commands
- `stmt` declares general parser-level statements

`cmd` should stay narrow:

- exactly one required implementation block
- execution-oriented shell registration
- stored as `UserCommandDefinition`

`stmt` is the general form:

- registers a parser-level `StatementDeclaration`
- can be blockless, single-block, or multi-block
- does not imply an executable shell command body
- should not create a `UserCommandDefinition`

Examples of the intended split:

```text
cmd greet name { echo $name }
stmt declare name
stmt if condition (then {}) [else {}]
```

## Remaining Work

Only the unfinished work is listed here.

### Remaining Stage 2 Work: Finish The Block Declaration Model

The parser already has a separate block channel and shape-only declaration blocks. The remaining Stage 2 gap is invocation-bound block metadata.

Current mismatch:

- declaration-time trailing blocks are now shape-only metadata, but invocation-time keyed block clauses are still declared with only a bare block marker
- invocation-bound blocks are parsed structurally and currently carry no declaration-driven metadata of their own
- clause-bound block metadata and trailing-block metadata are not yet expressed through one fully general statement declaration surface

- [x] Replace content-bearing declaration-time block storage with a shape-only block declaration model.
- [x] Finish the move from a concrete stored block shape toward an explicit declaration shape such as `StatementBlockDecl`.
- [x] Support per-block metadata for invocation-bound blocks instead of only a single shared invocation `blockScope`.
- [x] Move command-specific declaration bodies into shell-specific implementation storage that sits alongside shape-only parser statement declarations.

This part is now complete. Blocks stay separate from arguments, and both trailing statement blocks and clause-bound block markers are declarative parser metadata rather than parser-owned runtime state.

#### Settled Decisions

These points should stay fixed while finishing Stage 2:

- blocks stay separate from ordinary arguments in `ParsedStatement`
- statement declarations define statement shape only; they do not store executable block bodies
- statement declarations may record block language metadata, but that metadata remains declarative
- keyed clause block syntax using `{}` is already selected and should remain the declaration syntax for invocation-bound blocks
- for now, statements are handled only by built-in TypeScript handlers
- user-defined statement handlers are out of scope for this stage and should be treated as future work
- `cmd` stays a shell command declaration form, not the general statement declaration form
- the future general shell-facing form is `stmt`, not a widened `cmd`

#### Guiding Principles

These principles now drive the remaining design and implementation plan:

- parsing constructs belong in the parser
- runtime constructs belong in shell code

In practice that means:

- the parser owns declarative statement shape, clause structure, and block metadata declared in syntax
- the shell owns execution handlers, resolved languages, invocation-time state, and environment-dependent behavior
- if a field or option is only needed to execute a statement, it should not live in parser-owned declaration or invocation types

#### Selected Proposal

##### 1. What exact parser types should represent shape-only statement declarations?

This decision is now selected:

- `StatementDeclaration` defines only the shape of the statement
- block declarations record declarative metadata such as name, cardinality, and language
- `StatementDeclaration` does not store executable block bodies
- execution is currently provided only by built-in TypeScript handlers

Selected direction:

```ts
interface StatementBlockDecl {
	name: string;
	required: boolean;
	allowMultiple?: boolean;
	languageName?: string;
}

interface StatementDeclaration {
	name: string;
	argumentOperatorSetName?: string;
	qualifiers: QualifierDecl[];
	argDecls: ArgDeclGroup;
	blocks: StatementBlockDecl[];
	globalKeywords: Set<string>;
}
```

Built-in statement handlers should reference these declarations through shell/runtime registration, not by extending parser declaration types with execution fields.

For this stage, built-in statements should be interpreted by TypeScript handlers that know how to process the parsed statement shape. A later system for user-code-defined handlers can build on top of this, but it should not affect the Stage 2 parser model.

##### 2. How should invocation-time block clauses declare metadata?

This decision is now selected:

- blocks bound to clause keywords store their metadata in `KeyedClauseDecl`
- top-level trailing block sections store their metadata in `StatementDeclaration.blocks`
- this split is intentional because keyword-bound blocks are clause-local while the trailing block is statement-level

That means invocation-time block clauses should no longer be modeled as only a boolean block marker.

Selected direction:

```ts
interface ClauseBlockDecl {
	languageName?: string;
}

interface KeyedClauseDecl {
	keyword: string;
	required: boolean;
	allowMultiple: boolean;
	argDecls: ArgDeclGroup;
	block?: ClauseBlockDecl;
}
```

And for the statement-level trailing block:

```ts
interface StatementDeclaration {
	name: string;
	argumentOperatorSetName?: string;
	qualifiers: QualifierDecl[];
	argDecls: ArgDeclGroup;
	blocks: StatementBlockDecl[];
	globalKeywords: Set<string>;
}
```

Single proposal:

- clause-bound block metadata lives on `KeyedClauseDecl.block`
- top-level trailing block metadata lives in `StatementDeclaration.blocks`
- `StatementDeclaration.blocks` remains an array because the parser model needs to represent zero, one, or many top-level block sections
- parser metadata remains declarative; no resolved runtime objects are stored here

If clause-bound metadata needs to grow later, it should grow as additional declarative fields on `ClauseBlockDecl`, not as runtime state.

##### 3. How should per-block language metadata be represented?

This decision is now selected:

- declaration-time blocks carrying `languageName`
- parser statement declarations remain purely declarative and do not carry invocation-time block state
- the parser should not define a general statement-execution concept for invocation-time blocks
- general statement handling is deferred; for now the runtime boundary is an abstract handler call that receives a general environment object
- shell-specific handlers such as `cmd` may maintain invocation-time state, but that state belongs to the shell/runtime layer rather than the parser declaration model

Selected boundary:

- parser declarations store language names only
- parser data structures do not resolve those names into `Language` objects as part of statement declaration or statement invocation modeling
- parser-level statement handling should be explainable as an abstract handler interface that receives the parsed statement plus a general environment object
- if a concrete runtime needs invocation-time block state, it owns that state itself

Recommended boundary:

- declaration structures store declarative metadata such as `languageName`
- for clause-bound blocks, that metadata lives on `KeyedClauseDecl.block`
- for top-level trailing block sections, that metadata lives in `StatementDeclaration.blocks`
- runtime or shell integration may resolve that metadata to actual runtime objects when needed
- that resolution does not belong in parser statement declaration types or parser-owned statement invocation options

That keeps parser declarations serializable and avoids baking runtime execution policy into parser data structures.

##### 4. How should `cmd ... { ... }` compatibility map into the generalized model?

This is now a selected shell-side proposal rather than an open question.

The current trailing block syntax is still useful for executable shell commands, but it no longer belongs in parser-level statement declarations.

Selected direction:

```ts
interface UserCommandDefinition {
	declaration: StatementDeclaration;
	implementationBody: string;
	bodyLanguageName?: string;
	argumentOperatorSet?: OperatorSetDefinition;
	resolvedBodyLanguage?: Language;
}
```

- keep `cmd` surface syntax unchanged for executable shell commands
- keep parser `StatementDeclaration` shape-only
- let `cmd` produce two outputs at the shell layer: a shape-only parser declaration and separate shell-specific implementation data
- let shell-specific command execution own any invocation-time block state it needs
- let future `stmt` declarations remain shape-only and built-in-handler-oriented

That preserves compatibility for commands without letting command bodies redefine what a parser statement declaration is.

##### 5. What should be validated by parser code vs shell/runtime code?

This split is now selected.

Selected split:

- declaration validation: duplicate block names, invalid block metadata, schema contradictions, collisions between keyed block clauses and declared block sections
- shell/runtime validation: missing required bound blocks, repeated non-repeatable blocks in command-specific flows, command-specific invocation-time state consistency

##### 6. How much normalization should happen during parsing?

This decision is now selected:

- normalize immediately so both trailing blocks and keyed block clauses feed one internal parser-owned declarative representation
- `parseStatementDeclaration` should produce the final parser-owned declarative model directly
- if a shell-specific form such as `cmd` needs temporary parsing of runtime-oriented syntax, that temporary shape should stay in shell code rather than becoming a second parser-owned declaration model

That keeps the rest of the parser and validation logic working against one block model instead of branching on syntax source.

Examples of normalization steps:

1. Clause cardinality syntax should normalize immediately.

Example source:

```text
(then {})
[else {}]
[case {}]*
```

Normalized parser shape:

```ts
{ keyword: "then", required: true, allowMultiple: false, ... }
{ keyword: "else", required: false, allowMultiple: false, ... }
{ keyword: "case", required: false, allowMultiple: true, ... }
```

The rest of the parser should work with `required` and `allowMultiple`, not with the original bracket or quantifier spelling.

2. Keyed block markers should normalize from syntax markers into declarative block metadata.

Example source:

```text
stmt if condition (then {}) [else {}]
```

Normalized parser shape:

```ts
{
	keyword: "then",
	required: true,
	allowMultiple: false,
	argDecls: { ... },
	block: {}
}
```

Later, if clause-bound metadata grows, that growth should happen on `KeyedClauseDecl.block`, not by reintroducing ad hoc syntax-specific checks elsewhere.

3. Top-level trailing block sections should normalize into top-level statement block metadata.

Example source:

```text
stmt render target { ... } :: template_lang
```

Normalized parser shape:

```ts
blocks: [
	{
		name: "body",
		required: true,
		allowMultiple: false,
		languageName: "template_lang"
	}
]
```

The parser should not preserve a separate “trailing block syntax” representation after this step.

4. Keyword-bound blocks and trailing blocks should normalize into one declarative model while still preserving where metadata belongs.

Example source:

```text
stmt if condition (then {}) [else {}]
stmt render target { ... } :: template_lang
```

Normalized rule:

- clause-local metadata stays on `KeyedClauseDecl.block`
- statement-level trailing block metadata stays in `StatementDeclaration.blocks`

So the parser gets one normalized declaration model, but not by forcing clause-local and statement-level metadata into the same field.

5. Runtime-oriented command body handling should not be normalized into parser declarations.

Example source:

```text
cmd greet name { echo $name } :: shell
```

Selected handling:

- the parser-owned declaration shape becomes the same normalized statement declaration form used elsewhere
- the shell adapter keeps the executable command body text and any invocation-time command state in shell-specific structures

So normalization happens early for parser-owned declarative structure, but not for shell-owned runtime state.

6. Name resolution and runtime object attachment should not be part of parser normalization.

Example source:

```text
stmt render target { ... } :: template_lang
```

Parser normalization should keep:

```ts
languageName: "template_lang"
```

Parser normalization should not do:

```ts
resolvedLanguage: Language
scope: Language
```

Those belong to shell/runtime code if and when execution needs them.

#### Concrete Outcome Wanted From Stage 2

When this work is done, the parser should be able to say all of the following cleanly:

- what block sections a statement allows
- which of those sections are required or repeatable
- what declarative metadata each block section carries

And it should say that without relying on:

- a content-bearing declaration block type as the primary schema object
- a parser-owned invocation-time block scope concept

For now, execution should be explainable like this:

- parser statement declarations describe shape
- the runtime dispatches built-in statements to TypeScript handlers through an abstract handler boundary that receives a general environment object
- the parser does not own a general statement-execution model for invocation-time blocks
- shell-specific handlers such as `cmd` may maintain additional invocation-time state outside the parser model
- user-code-defined statement handlers are a later layer, not part of the current Stage 2 design

#### Suggested Implementation Breakdown

1. Replace `StatementBlock` with a shape-only block declaration type in parser declarations.
2. Replace the boolean keyed-clause block marker with `KeyedClauseDecl.block?: ClauseBlockDecl` so clause-bound metadata is parser-owned and declarative.
3. Keep top-level trailing block metadata in `StatementDeclaration.blocks` and keep that field shape-only.
4. Introduce shell-specific command implementation storage for `cmd`, including command body text and any invocation-time state needed by shell execution.
5. Move any necessary runtime-facing block handling out of parser APIs and into shell code first.
6. After the shell owns the needed runtime behavior, eliminate parser-owned runtime remnants rather than preserving adapter fields indefinitely.
7. In particular, remove or migrate parser-owned runtime concepts such as shared `blockScope`, parser-resolved nested block scope, and any other execution-only block state.
8. Update parser validation to stay structural and update shell/runtime validation to cover command execution rules.
9. Update tests so parser tests cover declarative statement shape only, while shell tests cover `cmd` runtime behavior and any remaining invocation-time state.

### Shell Work: `stmt`

To expose the generalized statement model at the shell level, the shell now includes a separate `stmt` declaration command.

- [x] Add a shell `stmt` command that registers parser-level statement declarations.
- [x] Keep `cmd` command-specific and execution-specific.
- [x] Ensure `stmt` does not create executable `UserCommandDefinition` entries.
- [x] Route general parser-level constructs such as blockless declarations and multi-block declarations through `stmt`, not through `cmd`.

This keeps the shell boundary honest:

- `cmd` remains "define an executable shell command"
- `stmt` becomes "define a general statement form"

#### Suggested Implementation Proposal

Recommended direction:

- do not make the first `stmt` implementation rebuild the shell parser from environment state on every parse
- do not widen `cmd` again to carry general statement declarations
- implement `stmt` as a shell-side registration plus a second-stage parse/dispatch path that reuses `parseInvocation`

Why this is the recommended first step:

- the current shell parser already preserves `statement.raw`, which is enough to feed a second parsing stage against a registered `StatementDeclaration`
- `parseInvocation` already understands the richer declaration model that `stmt` is supposed to expose
- rebuilding parser configuration dynamically would couple the new `stmt` work back to the older `StatementDefinition` path before the declaration-based execution boundary is settled
- this keeps parser-owned statement shape and shell-owned execution policy separate

Suggested MVP shape:

1. Add a shell-side statement declaration registry.

Suggested shape:

```ts
interface RegisteredStatementDefinition {
	declaration: StatementDeclaration;
	argumentOperatorSet?: OperatorSetDefinition;
}
```

This should live alongside shell-owned command registration, but remain distinct from `UserCommandDefinition`.

2. Add a shell `stmt` command that parses and validates a `StatementDeclaration`, then stores it in that registry.

Selected boundary for the first pass:

- `stmt` stores shape only
- `stmt` does not store executable bodies
- `stmt` does not create a user command entry
- `stmt` should reject collisions with built-in declaration commands such as `cmd`, `stmt`, `language`, `operators`, and `statements`

3. Add a declaration-based shell executor layer for built-in statement handlers.

Suggested shape:

```ts
type ShellDeclaredStatementExecutor = (
	invocation: ParsedStatement,
	context: ShellCommandContext,
	environment: ShellEnvironment,
	scope?: Language
) => string | undefined;
```

For the first implementation, `stmt` should only register statement names that already have a built-in declaration-aware handler. That keeps behavior in TypeScript handlers and avoids introducing user-defined statement bodies too early.

This is now a selected simplification rather than an open question.

4. Keep the existing shell parser as a bootstrap parser.

Recommended execution flow:

- parse the line once through the current shell parser to identify the statement name and preserve the raw source
- if the statement name is a shell declaration command such as `cmd`, `stmt`, `language`, `operators`, or `statements`, keep using the existing executor path
- if the statement name has a registered `stmt` declaration, run a second parsing stage on `statement.raw` with `parseInvocation` against that declaration, then dispatch through the declaration-based handler map
- otherwise fall back to the legacy built-in statement path or OS-command fallback, depending on the name

This makes `stmt` registration a shell dispatch concern rather than a parser bootstrap concern.

5. Let registered `stmt` declarations override the legacy built-in statement schema for the same name.

That gives a clean migration path:

- old `StatementDefinition` entries remain in the static shell parser only as bootstrap compatibility
- the declaration-based execution path becomes authoritative for any statement name explicitly registered with `stmt`
- built-ins such as `if`, `while`, and `for` can migrate one at a time without forcing a single large parser rewrite

#### Suggested Scope For The First `stmt` Pass

Recommended first-pass support:

- blockless declarations
- positional arguments, qualifiers, keyed clauses, and varargs already supported by `StatementDeclaration`
- keyed invocation-time block clauses such as `(then {})`
- top-level trailing invocation blocks driven by `StatementDeclaration.blocks`
- built-in TypeScript handlers only

Recommended deferrals for the first pass:

- user-defined statement handlers
- integration with `statements` and `language` declarations
- automatic conversion from `StatementDeclaration` into the older `StatementDefinition` model

This now implies one explicit prerequisite for the implementation plan:

- before `stmt` lands, extend invocation parsing and shell dispatch so `StatementDeclaration.blocks` is consumed as real invocation-time block sections
- that support should cover zero-block, single-block, and multi-block statement invocations so declarations such as `stmt if condition (then {}) [else {}]` and future trailing-block forms use the same declaration model
- this support should be implemented now rather than deferred, so `stmt` can cover important statement shapes early

#### Suggested Testing Plan For `stmt`

- add shell tests for `stmt` registration and name-collision validation
- add shell tests showing that `stmt` does not create `UserCommandDefinition` entries
- add shell tests showing that a registered declaration sends `statement.raw` through a second parsing stage via `parseInvocation`
- add shell tests for at least one migrated built-in handler, preferably `if`, on the declaration-based execution path
- add shell tests proving `cmd` behavior is unchanged
- add parser and shell tests for zero-block, single-block, and multi-block `stmt` invocations driven by `StatementDeclaration.blocks`

## Testing Status

- [x] Parser tests cover renamed parser APIs.
- [x] Parser tests cover zero-block, single-block, and multi-block declarations.
- [x] Parser tests cover invocation-time block clauses and block validation.
- [x] Shell tests cover command narrowing in `cmd`.
- [x] Shell tests cover generalized `if`, `while`, and `for` execution.
- [x] Add focused tests for the selected shape-only parser model and shell-owned `cmd` runtime state.

## Recommended Next Implementation Order

1. Refactor parser declaration types to the selected shape-only model.
2. Add shell-specific storage for `cmd` bodies and move any necessary invocation-time block handling there.
3. Remove the corresponding runtime-oriented parser fields and options once the shell owns the needed behavior.
4. Add `stmt` as the general shell-facing statement declaration command.
5. Update docs and tests so the parser/runtime boundary is enforced consistently.

Implementation checkpoint:

- [x] Steps 1 through 3 are now complete.
- [ ] Step 4 (`stmt`) remains future shell work.
- [ ] As part of Step 4, top-level trailing invocation blocks should be implemented before or alongside the first `stmt` pass.
