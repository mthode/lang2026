# Shell language

This directory defines shell parsing and command execution.

Expression evaluation and function-body statement execution live in `lang/`.
For full function-language semantics, see [../lang/README.md](../lang/README.md).

## Statement model

The shell has two statement contexts:

- Top-level shell statements (interactive lines, scripts, and `cmd` bodies)
- Function-body statements (inside `func ... { ... }`)

These are intentionally different.

## Top-level shell statements

Supported statement kinds:

1. Assignment statement
2. Command statement

### 1) Assignment statement

Syntax:

- `IDENTIFIER = EXPRESSION`

Example:

- `x = 10`
- `eval x * 2`

### 2) Command statement

Syntax:

- `COMMAND_NAME ARGUMENTS...`

Examples:

- `echo hello`
- `if 1 then { echo yes }`

If a command name is not a built-in and not user-defined via `cmd`, execution falls back to the OS command runner (Node runtime only).

## Expressions and functions in shell

Shell statements can use expressions (for assignment, `eval`, conditions, and loop ranges).

`func` defines expression functions, but the function language itself (expression/function-body semantics) is documented in [../lang/README.md](../lang/README.md).

## Commands vs expression functions

Commands and expression functions are separate namespaces and call sites:

- Commands run as statements: `echo hi`, `cmd greet name { ... }`
- Functions run in expressions: `eval add(3, 4)`

Cross-calls are rejected:

- Calling a function as a command fails.
- Calling a command as a function fails.

## Built-in commands

### `cd`

Change current working directory.

Syntax:

- `cd PATH`

### `eval`

Evaluate one expression and return a numeric result as text.

Examples:

- `eval 1 + 2 * 3`
- `eval -(10 / 2)`

### `echo`

Print arguments as a single line.

### `if`

Shell command conditional.

Syntax:

- `if EXPRESSION then { COMMANDS }`
- `if EXPRESSION then { COMMANDS } else { COMMANDS }`

### `while`

Shell command loop.

Syntax:

- `while EXPRESSION do { COMMANDS }`

Special variable:

- `$loop` in condition/body interpolation.

### `for`

Shell command counted loop.

Syntax:

- `for ITERATOR from START_EXPR to END_EXPR do { COMMANDS }`
- `for ITERATOR from START_EXPR to END_EXPR step STEP_EXPR do { COMMANDS }`

Special variable:

- `$ITERATOR` in body interpolation.

### `cmd`

Define a custom command.

Syntax:

- `cmd COMMAND_NAME ARG_DECLS { COMMANDS }`

Argument declaration format:

- Positional: `name`
- Optional positional: `[name]`
- Named with arity: `NAME:NUM_ARGS`
- Optional named with arity: `[NAME:NUM_ARGS]`

`NUM_ARGS`:

- `0` => flag
- `1` => single value
- `N > 1` => exactly `N` values

Use `$argName` inside command bodies.

### `stmt`

Register a parser-level statement shape.

Syntax:

- `stmt STATEMENT_NAME ARG_DECLS`
- `stmt STATEMENT_NAME ARG_DECLS (blockName {}) [optionalBlock {}]`

Example:

- `stmt choose condition (then {}) [else {}]`
- `statements mini_shell { echo choose }`
- `language mini_lang statements mini_shell operators shell_ops`

`stmt` declarations are intentionally parse-only in the current runtime. They can be pulled into named `statements` sets and used by named `language` objects, but they do not create executable shell commands. If such a parsed statement is executed by the shell without a future runtime handler, it follows the normal fallback path for unknown commands.

`stmt` declarations are converted into parser-owned `StatementDefinition` values. The supported declaration surface includes qualifiers, `--evaluate` operator-set selection, positional arguments, top-level blocks, block language annotations, keyed clauses with ordinary arguments, invocation-time block clauses, nested keyed clauses, repeated keyed clauses, and vararg trailing named arguments.

### `func`

Define an expression function.

Syntax:

- `func FUNCTION_NAME ( PARAMS ) { FUNCTION_STATEMENTS }`

Example:

- `func add ( a, b ) { a + b }`
- `eval add(3, 4)`

For complete function-statement semantics, see [../lang/README.md](../lang/README.md).

## Runtime notes

### Prompt

Terminal prompt includes current directory (for example `/home/user/project> `).

### External OS commands

When command lookup misses shell built-ins and user `cmd` definitions, execution is delegated to OS commands in Node runtime.

In browser runtime this throws:

- `OS commands are not available on the web`
