# Lang module

This directory defines the core expression language runtime.

It includes:

- expression parsing configuration
- expression evaluation
- expression function call execution
- function-body statement parsing/evaluation (`if`, `while`, `for`, expression statements)

Shell commands (including `func`) stay in `shell/`, while function semantics are implemented here and can be reused by other runtimes.

## Expression language

Expressions are numeric and include:

- literals: numbers
- identifiers (variable lookup)
- prefix operators: `+`, `-`
- binary operators: `+`, `-`, `*`, `/`
- function calls: `name(arg1, arg2, ...)`

Identifiers resolve from local scope first, then global scope.

## Expression functions

Expression functions are callable only from expressions.

Example:

- `func add ( a, b ) { a + b }`
- `eval add(3, 4)`

Function calls:

- must target a named callee
- must match parameter count
- execute with a local scope containing parameter bindings

Commands and functions are separate:

- calling a command as a function is an error
- executing a function as a command is an error

## Function-body statements

Function bodies support this statement set:

1. Expression statement
2. `if` statement
3. `while` statement
4. `for` statement

### 1) Expression statement

Any expression used as a statement.

Example:

- `a + b`

### 2) Function `if`

Syntax:

- `if CONDITION { FUNCTION_STATEMENTS }`
- `if CONDITION { FUNCTION_STATEMENTS } else { FUNCTION_STATEMENTS }`

`CONDITION` is numeric truthiness (`0` false, non-zero true).

### 3) Function `while`

Syntax:

- `while CONDITION do { FUNCTION_STATEMENTS }`
- `while CONDITION { FUNCTION_STATEMENTS }` (also accepted)

Behavior:

- re-evaluates `CONDITION` each iteration
- exposes local `loop` counter (`0`, `1`, `2`, ...)
- stops when condition evaluates to `0`
- guarded by max-iteration protection

### 4) Function `for`

Syntax:

- `for ITERATOR from START to END do { FUNCTION_STATEMENTS }`
- `for ITERATOR from START to END step STEP do { FUNCTION_STATEMENTS }`
- `do` is optional before `{ ... }`

Behavior:

- `ITERATOR` must be an identifier
- default `STEP` is `1`
- `STEP = 0` is an error
- positive step iterates while `value <= END`
- negative step iterates while `value >= END`
- guarded by max-iteration protection

## Integrations

This module is runtime-agnostic and can be consumed by different hosts.

Current integration:

- `shell/` uses this module for expression evaluation, expression rendering, and expression-function execution.

See `../shell/README.md` for shell command syntax and shell runtime behavior.
