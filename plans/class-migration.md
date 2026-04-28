# Class Migration

## Goal

Migrate the codebase away from exported interface-plus-object-initializer domain values and toward traditional classes with constructors. The project is still early stage, so this can be a breaking API cleanup.

## Assumptions

- Private parser bookkeeping shapes can remain lightweight interfaces when they are not part of the public model and do not represent durable domain values.
- Public parser, language, scanner, shell, and expression runtime shapes should become classes when they represent constructed values.
- Existing factory functions may remain temporarily as compatibility helpers, but they should construct classes internally.

## Tasks

- [x] 1. Survey the current interface and initializer usage.
  - Main exported structural shapes are in `scanner/index.ts`, `parser/expression.ts`, `parser/statement.ts`, `parser/language.ts`, `shell/declaration.ts`, `shell/commands/types.ts`, `lang/types.ts`, and the statement helper modules.
  - Existing classes are limited mostly to `ReplEngine`, terminal test doubles, and parser `PartInfo`.

- [x] 2. Convert scanner and expression domain values to classes.
  - Replace `Token` and `LogicalLine` interface construction with constructors.
  - Replace expression AST object literals with node classes.
  - Convert operator/config shapes to classes where they are constructed or cloned.
  - Status: `Token`, `LogicalLine`, expression AST nodes, operator definitions, operator overrides, and expression parser config are class-backed.

- [x] 3. Convert parser statement and language model values to classes.
  - Replace statement node, nested block, parsed clause, and statement definition shapes with classes.
  - Update parser construction sites to instantiate node and definition classes.
  - Update `Language`, `OperatorSetDefinition`, and `StatementSetDefinition` to class constructors and clone through constructors.
  - Status: parser statement AST nodes, statement definition pieces, parser config, language objects, and built-in shell statement definitions are class-backed.

- [x] 4. Convert shell/runtime declaration values to classes.
  - Replace shell declaration and parsed invocation shapes with classes where they are stored or returned.
  - Replace shell environment and user command definition initializers with constructors.
  - Preserve browser and Node runtime support.
  - Status: shell declarations, parsed invocations, shell environment, user command definitions, REPL result objects, shell source results, shell runtime, function definitions, and function statement nodes are class-backed.

- [x] 5. Update tests and add focused coverage for class construction.
  - Keep existing behavior assertions passing.
  - Add unit tests that verify representative parser and shell values are class instances.
  - Status: added parser tests covering representative scanner, expression, parser, declaration, invocation, environment, language, and user command instances.

- [x] 6. Run typecheck and unit tests, then update this plan with final status.
  - `npm run typecheck` passes.
  - `npm test` passes with 168 tests.
