# Shell Commands

This directory defines the shell language configuration and command execution.

## Command files

- `commands/eval.ts` - Evaluates a single arithmetic expression.
- `commands/echo.ts` - Prints command arguments.
- `commands/if.ts` - Conditional command execution with `then` and optional `else` blocks.
- `commands/command.ts` - User-defined command declarations and invocation.
- `commands/while.ts` - Loop while a condition expression is non-zero.
- `commands/for.ts` - Counted loop with iterator, range, and optional step.

## Supported commands

### Prompt

In the terminal runtime, the prompt includes the current working directory, for example:

- `/home/user/project> `

The browser runtime does not include this prompt feature.

### External OS commands

If a command is not implemented by the shell (and is not a user-defined `cmd` command), the runtime tries to execute it using the operating system.

Behavior:

- Arguments are forwarded as raw strings.
- Expressions are not evaluated for external commands.
- In the browser runtime, this throws: `OS commands are not available on the web`.

### `cd`

Changes the current working directory used by the shell and external OS command execution.

Syntax:

- `cd PATH`

Examples:

- `cd ..`
- `cd /tmp`

### `eval`

Evaluates one expression and returns the numeric result as text.

Examples:

- `eval 1 + 2 * 3`
- `eval -(10 / 2)`

Supported operators for evaluation: `+`, `-`, `*`, `/`.

### `echo`

Prints arguments as a single line.

Examples:

- `echo hello world`
- `echo value is 42`

### `if`

Conditional execution with nested command blocks.

Syntax:

- `if EXPRESSION then { NESTED-COMMANDS }`
- `if EXPRESSION then { NESTED-COMMANDS } else { NESTED-COMMANDS }`

Behavior:

- `if` takes a positional condition expression argument.
- `then` and `else` are named arguments.
- `then` requires a single `nested-block` value.
- `else` takes a single optional `nested-block` value.
- Condition is evaluated via `eval` semantics.
- Numeric `0` is false; non-zero is true.
- Non-numeric non-empty output is true.
- `else` block is optional.

Examples:

- `if 1 then { echo yes }`
- `if 0 then { echo yes } else { echo no }`
- `if 1 then { if 0 then { echo a } else { echo b } }`

### `cmd`

Defines a custom command.

Syntax:

- `cmd COMMAND_NAME ARG_DECLS { COMMANDS }`

Argument declaration format:

- Positional arg: `name`
- Optional positional arg: `[name]`
- Named arg with arity: `NAME:NUM_ARGS`
- Optional named arg with arity: `[NAME:NUM_ARGS]`

`NUM_ARGS`:

- `0` => flag (no values)
- `1` => single expression value
- `N > 1` => exactly `N` expression values (available as a list)

All command argument values are parsed as expressions.

In command bodies, use `$argName` placeholders to reference parsed values.

Examples:

- `cmd add a b { eval $a + $b }`
- `cmd cfg flag:0 x:1 y:2 { echo $flag $x $y }`

### `while`

Syntax:

- `while EXPRESSION do { COMMANDS }`

Behavior:

- Condition is evaluated each iteration.
- Loop runs while condition is non-zero.
- Special variable `loop` is available inside condition and body interpolation as `$loop`.

Example:

- `while 3 - loop do { echo $loop }`

### `for`

Syntax:

- `for ITERATOR from START_EXPR to END_EXPR do { COMMANDS }`
- `for ITERATOR from START_EXPR to END_EXPR step STEP_EXPR do { COMMANDS }`

Behavior:

- `ITERATOR` must be an identifier.
- Default `step` is `1`.
- Positive step iterates while `value <= end`; negative step iterates while `value >= end`.
- Iterator is available in body interpolation as `$ITERATOR`.

Examples:

- `for i from 1 to 3 do { echo $i }`
- `for i from 1 to 5 step 2 do { echo $i }`
