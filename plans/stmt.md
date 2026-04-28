# Stmt Command Follow-up Plan

## Goal

Make `stmt` the shell-facing way to register parser-level statement shapes without collapsing back into command-specific runtime rules.

The immediate goal is not to make `stmt` declarations executable shell commands. The immediate goal is to make them usable as first-class statement declarations that can participate in named statement sets and languages.

The parser should converge on a single statement model centered on `StatementDefinition`. Any remaining shell-facing declaration helpers should be simplified and moved out of parser-owned types.

## Current Code Shape

- `shell/commands/statement.ts` already parses a `stmt` declaration, validates that trailing blocks are shape-only, and stores the resulting `StatementDeclaration` in `environment.statementDeclarations`.
- `shell/commands/types.ts` and `createShellEnvironment(...)` already provision the `statementDeclarations` registry.
- `parser/declaration.ts` and `parser/invocation.ts` currently implement a second parser-owned statement model used by `cmd` for declaration parsing and invocation validation.
- `shell/commands/language-object.ts` still builds `StatementSetDefinition` values only from `shellStatementDefinitions`, which means `stmt` declarations are not yet consumable by `statements` or `language`.
- `parser/statement.ts` still parses executable lines from the older `StatementDefinition` shape. That type is the active parser/runtime surface used by parser scopes, statement sets, and languages.
- `shell/index.ts` still executes parsed statements through the built-in executor table plus user `cmd` definitions. It does not consult `environment.statementDeclarations` at execution time.
- `test/shell.test.ts` covers declaration storage and basic validation for `stmt`, but not integration with named statement sets, languages, or any runtime handler story.

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

- [ ] 1.2 Decide whether `statements NAME { ... }` should snapshot `stmt` declarations or hold live references to them.
  Why this is consequential: live references make later `stmt` edits mutate existing languages invisibly, while snapshots make parser scopes stable and align with the current clone-on-registration behavior for operators, statements, and languages.
  Recommended starting point: snapshot on registration.

- [ ] 1.3 Decide whether newly declared `stmt` names should become visible in the top-level shell automatically.
  Why this is consequential: automatic visibility changes the interactive shell grammar globally and would make `stmt` declarations behave differently from the existing named language objects.
  Recommended starting point: do not auto-import them into the ambient shell language; require explicit inclusion through `statements` and `language`.

- [ ] 1.4 Decide what the first runtime story is for non-shell statements parsed through custom languages.
  Why this is consequential: today shell execution only knows built-ins, OS fallback, and user `cmd` definitions. A parsed custom statement currently has no execution hook.
  Recommended starting point: keep the first `stmt` integration parse-focused, and treat executable custom statement handlers as a follow-up layer with its own registry and tests.

- [ ] 1.5 Decide the minimum `StatementDefinition` feature set needed for parity with the statement shapes already accepted by `stmt`.
  Why this is consequential: this sets the scope of the parser refactor and determines whether the first pass can replace current declaration parsing fully or needs a temporary shell-side compatibility layer.
  Recommended starting point: target the shapes already relied on by `cmd` and `stmt` today, then defer any unused generalization.

## Implementation Plan

- [ ] 2. Refactor parser-owned statement modeling around `StatementDefinition` before extending statement-set integration.
  Shape notes:
  - Expand `StatementDefinition` so the parser can represent the statement forms that are currently only modeled through `StatementDeclaration`.
  - Identify which declaration concepts are truly parser concerns versus shell declaration-authoring concerns.
  - Move declaration-authoring interfaces that remain necessary after the refactor into shell code so parser code stops importing them.
  - Keep the parser-facing model shape-oriented and avoid attaching runtime execution behavior to it.
  - Plan for a temporary compatibility layer only if needed to land the refactor incrementally; that layer should be explicitly transitional.

- [ ] 3. Define the migration path from the current declaration parser to the unified parser statement model.
  Shape notes:
  - Decide whether `parseStatementDeclaration(...)` becomes a shell-side adapter over richer `StatementDefinition` construction or is replaced outright.
  - Decide how invocation validation currently handled by `parser/invocation.ts` is folded into parser-owned statement parsing and validation.
  - Keep shell command authoring ergonomic, but make the parser boundary obvious and one-directional.
  - Document any temporary duplication that is tolerated during migration and the condition for deleting it.

- [ ] 4. Extend `statements` declaration resolution so statement-set bodies can include both built-in shell statements and previously declared `stmt` names.
  Shape notes:
  - `shell/commands/language-object.ts` currently resolves only from `shellStatementDefinitions`.
  - The updated path should resolve names from built-ins first, then from shell-registered `stmt` definitions expressed in parser-owned form.
  - Duplicate names and unsupported migration states should fail with clear errors.

- [ ] 5. Keep parser-scope construction explicit.
  Shape notes:
  - `language` should keep building named parser scopes from named operator sets plus named statement sets.
  - `stmt` should not bypass that pipeline by mutating the ambient shell parser directly.
  - This keeps `stmt` aligned with the existing `operators` / `statements` / `language` object model.

- [ ] 6. Decide whether the first pass needs shell runtime execution hooks for custom parsed statements.
  Shape notes:
  - If parse-only reuse is sufficient, stop after statement-set/language integration and document the current execution boundary.
  - If execution is required, add a separate runtime registry keyed by statement name and declaration metadata rather than attaching executable behavior to `StatementDeclaration`.
  - Any execution layer should resolve block-language metadata from the shell-managed registration data, not from a shell-only parser shadow model.

- [ ] 7. Expand unit coverage around the selected slice before widening further.
  Tests should cover:
  - parser-level coverage for the expanded `StatementDefinition` surface
  - shell-level coverage for any simplified declaration parsing helpers that remain
  - `stmt` declarations being accepted by `statements { ... }`
  - snapshot versus live-reference behavior, whichever is selected
  - custom language parsing with a statement set that includes `stmt` declarations expressed through the unified parser model
  - runtime behavior boundaries, especially if executable custom statements remain out of scope for the first pass

- [ ] 8. Update shell-facing documentation once the selected scope is implemented.
  Documentation should explain:
  - what `stmt` registers
  - how `stmt` declarations become part of a language
  - whether those statements are parse-only or executable in the current release
  - that parser code is centered on `StatementDefinition` and shell declaration helpers are not a second parser model

## Assumptions

- For now, `stmt` names share a namespace boundary with built-in shell statements, user commands, and functions so that shell resolution remains deterministic.
- The first implementation should prefer a coherent single parser model over preserving parser-side duplication for compatibility.
- If the migration needs temporary adapters, they should be deleted as soon as parser consumers no longer depend on the old declaration pathway.

## Exit Criteria For This Plan

This plan is complete when all of the following are true:

- parser code uses a single statement model centered on `StatementDefinition`
- any remaining declaration-authoring interfaces live in shell code rather than parser code
- a `stmt` declaration can be intentionally pulled into a named statement set
- that statement set can be used by a named language without mutating the ambient shell parser
- unsupported or unimplemented shapes fail clearly instead of being silently lowered or silently dropped during migration
- the docs state whether the resulting statements are parse-only or executable
- unit tests cover the selected boundary