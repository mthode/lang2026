# Remove StatementSetDefinition

Refactor parser language definitions so statement configuration lives directly on `Language` instead of behind a separately constructible `StatementSetDefinition`.

The motivation is that a statement set should not exist independently of a language. Today `StatementSetDefinition` holds `name`, `statements`, `defaultStatement`, and `strictStatements`, then `Language` wraps that set with an `OperatorSetDefinition` and `allowAssignmentStatements`. This creates an unnecessary parser-level abstraction and leaks into shell registries and declaration commands.

## Current Shape

- `parser/language.ts`
  - Defines `OperatorSetDefinition`, `StatementSetDefinition`, and `Language`.
  - `Language` stores `statementSet: StatementSetDefinition` and `operatorSet: OperatorSetDefinition`.
  - `toParserConfig(...)` converts `language.statementSet` and `language.operatorSet` into `ParserConfig`.
  - `resolveNamedStatementSet(...)` and `cloneStatementSet(...)` make statement sets first-class parser values.
- `shell/custom-language.ts`
  - Seeds `shellStatementSet` independently from `shellLanguage`.
  - `createShellLanguageRegistries()` returns `statementSets: Map<string, StatementSetDefinition>` and `languages: Map<string, Language>`.
- `shell/commands/language-object.ts`
  - `statements NAME { ... }` creates a named `StatementSetDefinition`.
  - `language NAME statements STATEMENT_SET operators OPERATOR_SET` resolves the named statement set and combines it with an operator set.
- `shell/commands/types.ts`
  - `ShellEnvironment` stores `statementSets` separately from `languages`.
- Tests and docs import or describe `StatementSetDefinition` directly.

## Target Shape

- `StatementSetDefinition` is removed from parser exports.
- `Language` directly owns:
  - `name?: string`
  - `statements: Record<string, StatementDefinition>`
  - `defaultStatement?: StatementDefinition`
  - `strictStatements?: boolean`
  - `operatorSet: OperatorSetDefinition`
  - `allowAssignmentStatements?: boolean`
- Parser helpers convert directly from `Language` to `ParserConfig`.
- Shell-facing named statement sets go away.
- `language` declarations own their statement list inline using a body form similar to the existing `statements` command.

## Assumptions

- `OperatorSetDefinition` can remain independent because operator sets are reusable across languages and do not carry statement parser behavior.
- Existing named `statements NAME { ... }` syntax can be removed during this refactor.
- `stmt` declarations continue to register parser-owned `StatementDefinition` values in `environment.statementDeclarations`.
- Runtime execution behavior should not change in this refactor.

## Tasks

- [x] 1. Decide the shell declaration model for named statement groups.
  - [x] 1.1 Consequential decision: should the shell keep the existing two-step syntax, `statements NAME { ... }` followed by `language NAME statements NAME operators NAME`, using a shell-owned intermediate declaration type?
    - Decision: no. Named statement sets will be removed rather than preserved as shell-only state.
    - Why this matters: preserving syntax would minimize user-visible churn, but it would keep a named statement-group concept in the shell layer. The selected direction removes that concept entirely.
  - [x] 1.2 Consequential decision: should the shell replace or extend `language` syntax so a language can declare statements inline, avoiding durable named statement groups entirely?
    - Decision: yes. The set of statements will be declared inline in the `language` definition using a body form similar to the existing `statements` command.
    - Why this matters: this is cleaner conceptually, but it changes shell authoring flow and requires updates to scripts, docs, and tests.
  - [x] 1.3 Document the selected shell model in this plan before implementation.

- [x] 2. Refactor `parser/language.ts` so `Language` owns statement fields directly.
  - [x] 2.1 Remove the `StatementSetDefinition` class.
  - [x] 2.2 Add `name`, `statements`, `defaultStatement`, and `strictStatements` fields to `Language`.
  - [x] 2.3 Update the `Language` constructor and `createLanguage(...)` to accept direct statement and operator fields.
  - [x] 2.4 Replace `toStatementParserDefinition(statementSet)` with a helper that reads from `Language`.
  - [x] 2.5 Update `toParserConfig(...)`, `cloneLanguage(...)`, and related clone helpers.
  - [x] 2.6 Remove or replace `resolveNamedStatementSet(...)` and `cloneStatementSet(...)`.

- [x] 3. Update parser consumers to use the new `Language` shape.
  - [x] 3.1 Replace `language.statementSet.statements` reads with `language.statements`.
  - [x] 3.2 Replace direct `StatementSetDefinition` construction in parser tests with `Language` construction.
  - [x] 3.3 Verify `ParserConfig` output remains unchanged for strict statements, defaults, expression operators, and assignment statements.

- [x] 4. Remove shell named statement-set registries.
  - [x] 4.1 Remove `statementSets` from `ShellEnvironment` and `createShellLanguageRegistries()`.
  - [x] 4.2 Remove `shellStatementSet` and seed `shellLanguage` directly from `shellStatementDefinitions`, `shellOperatorSet`, default raw statement behavior, and assignment support.
  - [x] 4.3 Remove `registerStatementSet(...)` and any callers.
  - [x] 4.4 Keep `statementDeclarations` for `stmt` declarations as a registry of individual parser-owned `StatementDefinition` values.

- [x] 5. Update `shell/commands/language-object.ts`.
  - [x] 5.1 Remove or retire `executeStatementsCommand(...)` and the `statements` command executor registration.
  - [x] 5.2 Update `executeLanguageCommand(...)` to parse inline statement names from the language declaration body.
  - [x] 5.3 Update `parseLanguageDeclaration(...)` to support the selected shape, for example `language NAME operators OPERATOR_SET { STATEMENTS }`.
  - [x] 5.4 Resolve inline statement names from built-in shell statements first, then `environment.statementDeclarations`.
  - [x] 5.5 Keep validation for unknown statements, duplicate statements, unknown operator sets, duplicate language names, and malformed declaration bodies.
  - [x] 5.6 Add or update tests for inline language declaration syntax and removed named statement-set behavior.

- [x] 6. Update shell execution and body parsing call sites.
  - [x] 6.1 Replace `bodyLanguage.statementSet` and similar reads with direct `Language` statement fields.
  - [x] 6.2 Verify custom body language parsing still rejects unsupported statements.
  - [x] 6.3 Verify command argument operator sets and body languages are cloned at declaration time rather than staying live references.

- [x] 7. Update public exports, tests, and docs.
  - [x] 7.1 Remove `StatementSetDefinition` imports and instance tests.
  - [x] 7.2 Update parser README diagrams and examples so `Language` directly owns statements.
  - [x] 7.3 Update shell README syntax examples to remove named statement sets and show inline language statement declarations.
  - [x] 7.4 Update existing plan references only where they would mislead active implementation work.

- [x] 8. Run verification.
  - [x] 8.1 Run the unit test suite.
  - [x] 8.2 Add focused unit tests for any new shell-owned declaration type or changed `language` syntax.
  - [x] 8.3 Run TypeScript type checking if it is separate from the test command.

## Notes During Implementation

- Implementation is complete.
- Task 1 is resolved: named statement sets will be removed, and language declarations will include their statement list inline.
- `language NAME operators OPERATOR_SET { STATEMENTS }` is the implemented shell syntax.
