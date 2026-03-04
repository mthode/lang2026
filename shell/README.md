# Shell language

This directory defines shell parsing, statement execution, and expression-function execution.

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

## Function-body statements

`func` bodies use a separate statement set.

Supported function statement kinds:

1. Expression statement
2. Function `if` statement
3. Function `while` statement
4. Function `for` statement

### 1) Expression statement

Any expression as a statement.

Example:

- `a + b`

### 2) Function `if` statement

Syntax:

- `if CONDITION { FUNCTION_STATEMENTS }`
- `if CONDITION { FUNCTION_STATEMENTS } else { FUNCTION_STATEMENTS }`

`CONDITION` is an expression; `0` is false, non-zero is true.

### 3) Function `while` statement

Syntax:

- `while CONDITION do { FUNCTION_STATEMENTS }`
- `while CONDITION { FUNCTION_STATEMENTS }` (also accepted)

Behavior:

- `CONDITION` is re-evaluated each iteration.
- Local identifier `loop` is available in the condition and body (`0`, `1`, `2`, ...).
- Loop stops when condition evaluates to `0`.

### 4) Function `for` statement

Syntax:

- `for ITERATOR from START to END do { FUNCTION_STATEMENTS }`
- `for ITERATOR from START to END step STEP do { FUNCTION_STATEMENTS }`
- `do` is optional before `{ ... }`.

Behavior:

- `ITERATOR` must be an identifier.
- Default `STEP` is `1`.
- `STEP = 0` is an error.
- Positive step: iterate while `value <= END`.
- Negative step: iterate while `value >= END`.

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

### `func`

Define an expression function.

Syntax:

- `func FUNCTION_NAME ( PARAMS ) { FUNCTION_STATEMENTS }`

Example:

- `func add ( a, b ) { a + b }`
- `eval add(3, 4)`

## Runtime notes

### Prompt

Terminal prompt includes current directory (for example `/home/user/project> `).

### External OS commands

When command lookup misses shell built-ins and user `cmd` definitions, execution is delegated to OS commands in Node runtime.

In browser runtime this throws:

- `OS commands are not available on the web`
