# Stmt Command Follow-up Plan

## Goal

Make `stmt` the shell-facing way to register parser-level statement shapes without collapsing back into command-specific runtime rules.

The immediate goal is not to make `stmt` declarations executable shell commands. The immediate goal is to make them usable as first-class statement declarations that can participate in named statement sets and languages.

The parser should converge on a single statement model centered on `StatementDefinition`. Any remaining shell-facing declaration helpers should be simplified and moved out of parser-owned types.

## Current Code Shape

- `shell/commands/statement.ts` parses a `stmt` declaration, validates that trailing blocks are shape-only, converts it to `StatementDefinition`, and stores that parser-owned definition in `environment.statementDeclarations`.
- `shell/commands/types.ts` and `createShellEnvironment(...)` already provision the `statementDeclarations` registry.
- `shell/declaration.ts` and `shell/invocation.ts` implement shell-owned declaration parsing and invocation validation for `cmd`.
- `shell/commands/language-object.ts` builds `StatementSetDefinition` values from built-in shell statements first, then registered `stmt` definitions.
- `parser/statement.ts` parses executable lines from `StatementDefinition`, including the richer declaration features needed by `stmt`.
- `shell/index.ts` still executes parsed statements through the built-in executor table plus user `cmd` definitions. It does not consult `environment.statementDeclarations` at execution time, so custom `stmt` statements are parse-only in this slice.
- `test/shell.test.ts` covers declaration storage, named statement-set/language integration, richer statement shapes, live references, and the current parse-only runtime boundary.

## New Direction

- Parser code should own one statement model only.
- `StatementDefinition` is the long-term parser-owned shape and should be expanded until it can represent the statement forms the project needs.
- `StatementDeclaration` should stop being a richer parser abstraction than `StatementDefinition`.
- Shell-facing declaration parsing helpers may still exist, but any residual declaration-specific interfaces should live in shell code and should not be accessed by parser code.
- Statement-set and language plumbing should continue to consume parser-owned types, not shell-only declaration helpers.

## Confirmed Boundary

These points should stay fixed unless a later plan explicitly changes them:

- `stmt` remains declarative. It does not create a `UserCommandDefinition`.
- `stmt` does not attach an executable implementation block.
- Parser code converges on `StatementDefinition` as its single statement model.
- Runtime execution hooks, if added later, belong in shell/runtime code rather than parser declaration types.

## Desired User-Facing Shape

The intended shell story is still:

```text
stmt choose condition (then {} :: then_lang) [else {}]
stmt repeat count (do {})

statements mini_shell {
  echo
  choose
  repeat
}

language mini_lang statements mini_shell operators shell_ops
```

That shape implies two separate layers:

1. Declaration and registration of parser-level statement shapes.
2. Optional execution support for any statement names that are meant to run inside shell-managed bodies.

Those layers should be planned separately so that the parser model does not absorb shell runtime concerns.

## Recommended Direction

The pragmatic first delivery is:

- refactor parser-owned statement modeling so `StatementDefinition` can express the required declaration shapes
- simplify `StatementDeclaration` into a shell-facing helper layer, then move any remaining declaration-only interfaces out of parser code
- make `stmt` declarations consumable by `statements` and `language` through parser-owned `StatementDefinition` values
- keep top-level shell parsing unchanged unless a selected language explicitly includes those statements
- keep execution support for non-shell statements out of the first implementation unless a concrete runtime consumer needs it

This keeps the parser surface coherent before adding more statement-set integration work.

## Design Questions

- [x] 1.1 Decide whether statement sets should continue to be backed by `StatementDefinition` or move to `StatementDeclaration` directly.
  Decision: keep statement sets backed by `StatementDefinition` and treat it as the single parser-owned statement model.
  Why this is consequential: it sets the direction for all follow-up work. Instead of lowering a richer parser declaration model into statement sets, the parser surface itself needs to absorb the needed expressiveness.
  Follow-up implication: nested keyed clauses, repeated keyed clauses, and block metadata should be designed into `StatementDefinition` rather than preserved only in `StatementDeclaration`.

- [x] 1.2 Decide whether `statements NAME { ... }` should snapshot `stmt` declarations or hold live references to them.
  Decision: use live references.
  Why this is consequential: live references make later `stmt` edits mutate existing languages invisibly, while snapshots make parser scopes stable and align with the current clone-on-registration behavior for operators, statements, and languages.
  Follow-up implication: if stability becomes a problem later, address it by making statements immutable rather than by snapshotting now.

- [x] 1.3 Decide whether newly declared `stmt` names should become visible in the top-level shell automatically.
  Decision: do not auto-import them into the ambient shell language; require explicit inclusion through `statements` and `language`.
  Why this is consequential: automatic visibility changes the interactive shell grammar globally and would make `stmt` declarations behave differently from the existing named language objects.

- [x] 1.4 Decide what the first runtime story is for non-shell statements parsed through custom languages.
  Decision: keep the first `stmt` integration parse-focused, and treat executable custom statement handlers as a follow-up layer with its own registry and tests.
  Why this is consequential: today shell execution only knows built-ins, OS fallback, and user `cmd` definitions. A parsed custom statement currently has no execution hook.

- [x] 1.5 Decide the minimum `StatementDefinition` feature set needed for parity with the statement shapes already accepted by `stmt`.
  Decision: keep the initial `StatementDefinition` feature set fixed as it exists today.
  Why this is consequential: this narrows the first implementation slice and makes unsupported declaration features an explicit failure mode instead of forcing parser-surface expansion into the same change.
  Follow-up implication: unimplemented features should raise clear exceptions during declaration or registration until a later parity task expands `StatementDefinition`.

## Implementation Plan

- [x] 2. Refactor parser-owned statement modeling around `StatementDefinition` before extending statement-set integration.
  Shape notes:
  - Keep `StatementDefinition` as the sole parser-owned statement model, but do not expand its feature set in this first slice.
  - Identify which declaration concepts are truly parser concerns versus shell declaration-authoring concerns.
  - Move declaration-authoring interfaces that remain necessary after the refactor into shell code so parser code stops importing them.
  - Keep the parser-facing model shape-oriented and avoid attaching runtime execution behavior to it.
  - Any feature that cannot yet be represented by `StatementDefinition` fails explicitly rather than being partially lowered.
  - Shell declaration helpers now live under `shell/`; parser exports are centered on expression, statement, and language APIs.

- [x] 3. Define the migration path from the current declaration parser to the unified parser statement model.
  Shape notes:
  - Decide whether `parseStatementDeclaration(...)` becomes a shell-side adapter over richer `StatementDefinition` construction or is replaced outright.
  - Decide how invocation validation currently handled by `parser/invocation.ts` is folded into parser-owned statement parsing and validation.
  - Keep shell command authoring ergonomic, but make the parser boundary obvious and one-directional.
  - `parseStatementDeclaration(...)` is now shell-owned. `stmt` uses `statementDefinitionFromDeclaration(...)` as an adapter for the supported `StatementDefinition` subset.
  - `parseInvocation(...)` and `validateInvocation(...)` remain shell-owned for executable `cmd` declarations until `cmd` migrates to parser `StatementDefinition`.

- [x] 4. Extend `statements` declaration resolution so statement-set bodies can include both built-in shell statements and previously declared `stmt` names.
  Shape notes:
  - `shell/commands/language-object.ts` currently resolves only from `shellStatementDefinitions`.
  - The updated path should resolve names from built-ins first, then from shell-registered `stmt` definitions expressed in parser-owned form.
  - Statement-set membership should hold live references to the registered statements in this first design.
  - Duplicate names and unsupported migration states fail with clear errors.

- [x] 5. Keep parser-scope construction explicit.
  Shape notes:
  - `language` should keep building named parser scopes from named operator sets plus named statement sets.
  - `stmt` should not bypass that pipeline by mutating the ambient shell parser directly.
  - `stmt` remains invisible to the ambient shell parser unless pulled through `statements` and `language`.

- [x] 6. Decide whether the first pass needs shell runtime execution hooks for custom parsed statements.
  Shape notes:
  - If parse-only reuse is sufficient, stop after statement-set/language integration and document the current execution boundary.
  - If execution is required, add a separate runtime registry keyed by statement name and declaration metadata rather than attaching executable behavior to `StatementDeclaration`.
  - This pass is parse-only. Executable custom statement handlers remain a follow-up runtime layer.

- [x] 7. Expand unit coverage around the selected slice before widening further.
  Tests should cover:
  - parser-level coverage for the unified parser-owned `StatementDefinition` path in the selected first-pass subset
  - shell-level coverage for any simplified declaration parsing helpers that remain
  - `stmt` declarations being accepted by `statements { ... }`
  - live-reference behavior for statement-set membership
  - custom language parsing with a statement set that includes `stmt` declarations expressed through the unified parser model
  - runtime behavior boundaries, especially because executable custom statements remain out of scope for the first pass

- [x] 8. Update shell-facing documentation once the selected scope is implemented.
  Documentation should explain:
  - what `stmt` registers
  - how `stmt` declarations become part of a language
  - whether those statements are parse-only or executable in the current release
  - that parser code is centered on `StatementDefinition` and shell declaration helpers are not a second parser model

- [x] 9. Bring `StatementDefinition` capabilities up to parity with the current `StatementDeclaration` surface.
  Shape notes:
  - Add support for the declaration features that were intentionally rejected during the first integration slice.
  - Replace interim unsupported-feature exceptions with real parser-owned `StatementDefinition` support.
  - Keep parser code centered on one statement model while deleting any temporary compatibility checks that only existed because the first-pass feature set stayed fixed.
  - Revisit whether any remaining shell-side declaration helpers can be reduced further once parity is reached.
  Status: implemented. `StatementDefinition` now represents qualifiers, selected argument operator sets, keyed clauses, nested clauses, repeated clauses, invocation block metadata, top-level block metadata, and vararg trailing named arguments.

## Assumptions

- For now, `stmt` names share a namespace boundary with built-in shell statements, user commands, and functions so that shell resolution remains deterministic.
- The first implementation should prefer a coherent single parser model over preserving parser-side duplication for compatibility.
- `StatementDefinition` has been expanded after the first implementation slice to represent the statement shapes accepted by `stmt`.
- If the migration needs temporary adapters, they should be deleted as soon as parser consumers no longer depend on the old declaration pathway.
- Shell declaration and invocation helpers are still required by executable `cmd`; they are shell-owned and no longer exported from `parser/index.ts`.
- Statement-set and language registration keep live `StatementDefinition` object references for registered statements.

## Exit Criteria For This Plan

This plan is complete when all of the following are true:

- parser code uses a single statement model centered on `StatementDefinition`
- any remaining declaration-authoring interfaces live in shell code rather than parser code
- a `stmt` declaration can be intentionally pulled into a named statement set
- that statement set can be used by a named language without mutating the ambient shell parser
- statement shapes accepted by `stmt` are represented by `StatementDefinition` instead of being silently lowered or silently dropped during migration
- the docs state whether the resulting statements are parse-only or executable
- unit tests cover the selected boundary
